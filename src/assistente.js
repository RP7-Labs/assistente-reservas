import Anthropic from "@anthropic-ai/sdk";
import { carregarHotel, validarPedido, montarLinkMotor } from "./catalogo.js";
import { criarLead, carregarConversa, salvarConversa, marcarAtendente } from "./store.js";
import { responderPorRegras, hojeSP } from "./regras.js";

const MODELO = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_RODADAS = 6;

let client;
function cliente() {
  client ??= new Anthropic();
  return client;
}

function promptSistema(hotel) {
  const hoje = new Date().toISOString().slice(0, 10);
  return `Você é o assistente de reservas do ${hotel.nome} (${hotel.cidade}). Atende hóspedes por chat/WhatsApp, em português, com mensagens curtas e cordiais.

Objetivo: levar o hóspede até o link de reserva do quarto que ELE escolheu, no canal direto do hotel.

Regras:
- Para enviar um link, use sempre a ferramenta gerar_link_reserva. Nunca escreva um link por conta própria.
- Respeite a escolha do hóspede. Se ele pediu estúdio, o link é do estúdio. Só sugira outro quarto se o pedido não couber, e explique o motivo.
- Antes de gerar o link, confirme: tipo de quarto, data de entrada, data de saída, número de adultos e de crianças. Pergunte só o que faltar, uma coisa de cada vez.
- Converta datas relativas ("próxima sexta", "dia 12") para AAAA-MM-DD. Hoje é ${hoje}.
- Não invente preços, disponibilidade ou políticas além do catálogo. Os preços são "a partir de"; o valor final aparece no motor de reservas.
- Se o hóspede pedir algo fora de reserva (reclamação, pedido especial, grupo grande, evento), use chamar_atendente.

Catálogo:
${JSON.stringify({ checkin: hotel.checkin, checkout: hotel.checkout, politicas: hotel.politicas, quartos: hotel.quartos.map(({ codigo_motor, ...q }) => q) }, null, 2)}`;
}

const FERRAMENTAS = [
  {
    name: "gerar_link_reserva",
    description: "Gera o link de reserva no motor do hotel para o quarto escolhido pelo hóspede. Valida datas e capacidade; se houver erro, explique ao hóspede e ajuste.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        quarto_id: { type: "string", description: "id do quarto no catálogo" },
        checkin: { type: "string", description: "AAAA-MM-DD" },
        checkout: { type: "string", description: "AAAA-MM-DD" },
        adultos: { type: "integer" },
        criancas: { type: "integer" },
      },
      required: ["quarto_id", "checkin", "checkout", "adultos", "criancas"],
      additionalProperties: false,
    },
  },
  {
    name: "chamar_atendente",
    description: "Encaminha a conversa para um atendente humano do hotel.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string" } },
      required: ["motivo"],
      additionalProperties: false,
    },
  },
];

async function executarFerramenta(nome, entrada, ctx) {
  if (nome === "gerar_link_reserva") {
    const v = validarPedido(ctx.hotel, entrada);
    if (!v.ok) return { conteudo: JSON.stringify({ erro: v.erro }), erro: true };
    const lead = await criarLead({ canal: ctx.canal, conversa_id: ctx.conversaId, quarto_id: v.quarto.id, ...entrada, noites: v.noites });
    const linkMotor = montarLinkMotor(ctx.hotel, v.quarto, entrada, lead.id);
    // Link curto que passa pelo nosso servidor para contar o clique
    const link = ctx.publicUrl ? `${ctx.publicUrl}/r/${lead.id}` : linkMotor;
    ctx.eventos.push({ tipo: "link", lead_id: lead.id, quarto: v.quarto.nome, link });
    return { conteudo: JSON.stringify({ link, quarto: v.quarto.nome, noites: v.noites, preco_a_partir_por_noite: v.quarto.preco_a_partir }) };
  }
  if (nome === "chamar_atendente") {
    ctx.eventos.push({ tipo: "atendente", motivo: entrada.motivo });
    ctx.pedirAtendente = entrada.motivo;
    return { conteudo: JSON.stringify({ ok: true, aviso: "Um atendente vai continuar a conversa em breve." }) };
  }
  return { conteudo: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }), erro: true };
}

// Sem chave da IA (ou ASSISTENTE_MODO=regras), responde por regras, sem custo
export const modoAssistente = () =>
  process.env.ASSISTENTE_MODO === "regras" || !process.env.ANTHROPIC_API_KEY ? "regras" : "ia";

async function responderSemIA({ conversaId, texto, canal, publicUrl }) {
  const hotel = carregarHotel();
  const historico = await carregarConversa(conversaId);
  historico.push({ role: "user", content: texto });
  const falas = historico.filter((m) => m.role === "user" && typeof m.content === "string").map((m) => m.content);
  const r = responderPorRegras(hotel, falas, hojeSP());
  const eventos = [];
  let resposta = r.texto;
  if (r.acao?.tipo === "link") {
    const { quarto_id, ...pedido } = r.acao.pedido;
    const quarto = hotel.quartos.find((q) => q.id === quarto_id);
    const noites = Math.round((Date.parse(pedido.checkout) - Date.parse(pedido.checkin)) / 86_400_000);
    const lead = await criarLead({ canal, conversa_id: conversaId, quarto_id, ...pedido, noites });
    const link = publicUrl ? `${publicUrl}/r/${lead.id}` : montarLinkMotor(hotel, quarto, pedido, lead.id);
    resposta = resposta.replace("{link}", link);
    eventos.push({ tipo: "link", lead_id: lead.id, quarto: quarto.nome, link });
  }
  historico.push({ role: "assistant", content: [{ type: "text", text: resposta }] });
  await salvarConversa(conversaId, canal, historico);
  if (r.acao?.tipo === "atendente") {
    await marcarAtendente(conversaId, true, r.acao.motivo);
    eventos.push({ tipo: "atendente", motivo: r.acao.motivo });
  }
  return { resposta, eventos };
}

export async function responder({ conversaId, texto, canal = "web", publicUrl = process.env.PUBLIC_URL }) {
  if (modoAssistente() === "regras") return responderSemIA({ conversaId, texto, canal, publicUrl });
  const hotel = carregarHotel();
  const historico = await carregarConversa(conversaId);
  historico.push({ role: "user", content: texto });
  const ctx = { hotel, canal, conversaId, publicUrl, eventos: [] };

  for (let i = 0; i < MAX_RODADAS; i++) {
    const resp = await cliente().beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: promptSistema(hotel), cache_control: { type: "ephemeral" } }],
      tools: FERRAMENTAS,
      messages: historico,
    });

    historico.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "refusal") break;
    if (resp.stop_reason !== "tool_use") {
      await salvarConversa(conversaId, canal, historico);
      if (ctx.pedirAtendente) await marcarAtendente(conversaId, true, ctx.pedirAtendente);
      const resposta = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { resposta, eventos: ctx.eventos };
    }

    const resultados = await Promise.all(
      resp.content
        .filter((b) => b.type === "tool_use")
        .map(async (b) => {
          const r = await executarFerramenta(b.name, b.input, ctx);
          return { type: "tool_result", tool_use_id: b.id, content: r.conteudo, ...(r.erro ? { is_error: true } : {}) };
        }),
    );
    historico.push({ role: "user", content: resultados });
  }

  await salvarConversa(conversaId, canal, historico);
  await marcarAtendente(conversaId, true, ctx.pedirAtendente || "falha do assistente");
  return { resposta: "Desculpe, não consegui concluir agora. Vou chamar um atendente para te ajudar.", eventos: [...ctx.eventos, { tipo: "atendente", motivo: "falha do assistente" }] };
}
