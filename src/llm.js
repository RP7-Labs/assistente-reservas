// IA com plano gratuito (Gemini ou Groq) pela API compatível com OpenAI.
// Usa as mesmas ferramentas do modo Claude: link de reserva validado e chamar atendente.
// As dúvidas vêm da base data/conhecimento.md (RAG local) e as datas de feriado são calculadas aqui.
import { carregarHotel, validarPedido, montarLinkMotor } from "./catalogo.js";
import { criarLead } from "./store.js";
import { hojeSP } from "./regras.js";
import { sugerirPeriodo } from "./periodos.js";
import { buscar, topicos, porTitulo } from "./conhecimento.js";

const PROVEDORES = {
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai", modelo: "gemini-2.5-flash" },
  groq: { url: "https://api.groq.com/openai/v1", modelo: "llama-3.3-70b-versatile" },
};
const MAX_RODADAS = 5;

export function configLLM(env = process.env) {
  if (!env.LLM_API_KEY) return null;
  const p = PROVEDORES[env.LLM_PROVEDOR || "gemini"] ?? {};
  const url = env.LLM_BASE_URL || p.url;
  const modelo = env.LLM_MODELO || p.modelo;
  return url && modelo ? { url: url.replace(/\/$/, ""), modelo, chave: env.LLM_API_KEY, provedor: env.LLM_PROVEDOR || "gemini" } : null;
}

const normalizar = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function promptSistema(hotel, texto, hoje) {
  const semana = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(hoje + "T12:00:00Z"));
  // RAG: as seções da base mais parecidas com a mensagem
  const achado = porTitulo(texto) ?? buscar(texto);
  const periodo = sugerirPeriodo(normalizar(texto), hoje);
  return `Você é o assistente virtual de reservas do ${hotel.nome} (${hotel.cidade}). Atende hóspedes no chat do site e no WhatsApp, em português do Brasil, de forma calorosa, natural e breve (no máximo 3 frases curtas por mensagem). Hoje é ${semana}, ${hoje}.

Objetivo: ajudar o hóspede a reservar o quarto que ELE escolher, pelo canal direto do hotel, e tirar dúvidas.

Regras:
- Para reservar, você precisa de: quarto, data de entrada, data de saída (ou número de noites), adultos e crianças. Pergunte só o que falta, uma coisa por vez. Se o hóspede já disse algo, não pergunte de novo.
- Com tudo em mãos, chame a ferramenta gerar_link_reserva. Nunca escreva um link por conta própria. Depois, diga em uma frase o resumo e que o link leva ao pagamento.
- Respeite a escolha do hóspede. Só sugira outro quarto se o grupo não couber, explicando o motivo.
- Converta datas relativas ("sexta que vem", "dia 12") para AAAA-MM-DD a partir de hoje.
- Preços são "a partir de" por diária. Não invente preço, disponibilidade, política ou serviço que não esteja abaixo. Se não souber, diga que não tem a informação e ofereça chamar um atendente.
- Reclamações, grupos, eventos ou pedido de falar com uma pessoa: chame a ferramenta chamar_atendente.
- Botões: sempre que a resposta for uma pergunta com escolhas, termine com uma última linha no formato
  [opções: Opção 1 | Opção 2 | Opção 3]
  com até 6 opções curtas (até 24 letras), escritas como o hóspede responderia. Para pedir uma data, inclua a opção "Escolher data". Exemplos: ao perguntar o quarto, liste os quartos; ao perguntar noites, "1 noite | 2 noites | 3 noites"; no começo, "Fazer uma reserva | Ver quartos e preços | Dúvidas sobre o hotel".

Quartos (id: nome, capacidade, preço a partir de):
${hotel.quartos.map((q) => `- ${q.id}: ${q.nome}. ${q.descricao} Até ${q.capacidade_adultos} adultos e ${q.capacidade_total} pessoas. R$ ${q.preco_a_partir}/diária.`).join("\n")}

Check-in a partir das ${hotel.checkin}; check-out até as ${hotel.checkout}. ${hotel.politicas}

Assuntos que você sabe responder: ${topicos().join(", ")}.
${achado ? `\nInformação do hotel relevante para a última mensagem (${achado.titulo}):\n${achado.resposta}\n` : ""}${periodo ? `\nO hóspede citou ${periodo.nome}. Sugira estas datas (já calculadas, use exatamente estas):\n${periodo.opcoes.map((o) => `- entrada ${o.checkin}, saída ${o.checkout}`).join("\n")}\n` : ""}`;
}

export const FERRAMENTAS = [
  {
    type: "function",
    function: {
      name: "gerar_link_reserva",
      description: "Gera o link de pagamento/reserva do quarto escolhido. Valida datas e capacidade; se vier erro, explique ao hóspede e ajuste.",
      parameters: {
        type: "object",
        properties: {
          quarto_id: { type: "string", description: "id do quarto" },
          checkin: { type: "string", description: "AAAA-MM-DD" },
          checkout: { type: "string", description: "AAAA-MM-DD" },
          adultos: { type: "integer" },
          criancas: { type: "integer" },
        },
        required: ["quarto_id", "checkin", "checkout", "adultos", "criancas"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "chamar_atendente",
      description: "Encaminha a conversa para uma pessoa da equipe do hotel.",
      parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"] },
    },
  },
];

// O histórico fica salvo no formato de blocos (o mesmo do modo Claude), que o back-office já sabe ler.
// Aqui ele é convertido para o formato de mensagens da API compatível com OpenAI.
export function paraOpenAI(historico) {
  const msgs = [];
  for (const m of historico) {
    if (typeof m.content === "string") { msgs.push({ role: m.role, content: m.content }); continue; }
    const blocos = m.content ?? [];
    if (m.role === "assistant") {
      const texto = blocos.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const chamadas = blocos.filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      msgs.push({ role: "assistant", content: texto || null, ...(chamadas.length ? { tool_calls: chamadas } : {}) });
    } else {
      for (const b of blocos) {
        if (b.type === "tool_result") msgs.push({ role: "tool", tool_call_id: b.tool_use_id, content: String(b.content) });
        else if (b.type === "text") msgs.push({ role: "user", content: b.text });
      }
    }
  }
  return msgs;
}

// Separa a linha "[opções: A | B]" do texto e transforma em botões
export function extrairOpcoes(texto, hoje) {
  const m = texto.match(/\n?\s*\[op[cç][oõ]es:\s*([^\]]*)\]\s*$/i);
  if (!m) return { texto: texto.trim(), opcoes: [] };
  const opcoes = m[1].split("|").map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) =>
    /^escolher data/i.test(x) ? { rotulo: x, texto: "", tipo: "data", min: hoje } : { rotulo: x.slice(0, 40), texto: x });
  return { texto: texto.slice(0, m.index).trim(), opcoes };
}

async function chamarModelo(cfg, mensagens, buscarFn) {
  const r = await buscarFn(`${cfg.url}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.modelo, messages: mensagens, tools: FERRAMENTAS, temperature: 0.4, max_tokens: 600,
      // No Gemini 2.5 Flash, desliga o "raciocínio" para responder mais rápido
      ...(cfg.provedor === "gemini" ? { reasoning_effort: "none" } : {}),
    }),
    // Se demorar, desiste e o chat responde por regras
    signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS) || 15000),
  });
  if (!r.ok) throw new Error(`${cfg.provedor} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.choices?.[0]?.message ?? {};
}

// Responde uma mensagem. Recebe o histórico salvo e devolve o histórico novo, a resposta e os eventos.
export async function responderComLLM({ historico, texto, canal, conversaId, publicUrl, cfg = configLLM(), buscarFn = fetch, hoje = hojeSP() }) {
  const hotel = carregarHotel();
  const novo = [...historico, { role: "user", content: texto }];
  const eventos = [];
  let pedirAtendente = null;

  for (let i = 0; i < MAX_RODADAS; i++) {
    const msg = await chamarModelo(cfg, [{ role: "system", content: promptSistema(hotel, texto, hoje) }, ...paraOpenAI(novo)], buscarFn);
    const chamadas = msg.tool_calls ?? [];
    const blocos = [];
    if (msg.content) blocos.push({ type: "text", text: msg.content });
    for (const c of chamadas) {
      let entrada = {};
      try { entrada = JSON.parse(c.function?.arguments || "{}"); } catch { /* argumentos inválidos viram erro abaixo */ }
      blocos.push({ type: "tool_use", id: c.id, name: c.function?.name, input: entrada });
    }
    novo.push({ role: "assistant", content: blocos });

    if (!chamadas.length) {
      let { texto: resposta, opcoes } = extrairOpcoes(msg.content ?? "", hoje);
      // O link sempre vai no texto (no WhatsApp é o único jeito de clicar)
      for (const ev of eventos.filter((e) => e.tipo === "link")) if (!resposta.includes(ev.link)) resposta += `\n${ev.link}`;
      // guarda no histórico o texto sem a linha de opções
      blocos[0] = { type: "text", text: resposta };
      return { historico: novo, resposta, opcoes, eventos, pedirAtendente };
    }

    const resultados = [];
    for (const b of blocos.filter((x) => x.type === "tool_use")) {
      let conteudo;
      if (b.name === "gerar_link_reserva") {
        const entrada = { ...b.input, adultos: Number(b.input.adultos), criancas: Number(b.input.criancas ?? 0) };
        const v = validarPedido(hotel, entrada, new Date(hoje + "T12:00:00Z"));
        if (!v.ok) conteudo = JSON.stringify({ erro: v.erro });
        else {
          const lead = await criarLead({ canal, conversa_id: conversaId, quarto_id: v.quarto.id, checkin: entrada.checkin, checkout: entrada.checkout, adultos: entrada.adultos, criancas: entrada.criancas, noites: v.noites });
          const link = publicUrl ? `${publicUrl}/r/${lead.id}` : montarLinkMotor(hotel, v.quarto, entrada, lead.id);
          eventos.push({ tipo: "link", lead_id: lead.id, quarto: v.quarto.nome, link });
          conteudo = JSON.stringify({ link, quarto: v.quarto.nome, noites: v.noites, total_a_partir: v.quarto.preco_a_partir * v.noites });
        }
      } else if (b.name === "chamar_atendente") {
        pedirAtendente = String(b.input.motivo ?? "pedido do hóspede").slice(0, 200);
        eventos.push({ tipo: "atendente", motivo: pedirAtendente });
        conteudo = JSON.stringify({ ok: true, aviso: "Um atendente vai continuar a conversa em breve." });
      } else conteudo = JSON.stringify({ erro: `Ferramenta desconhecida: ${b.name}` });
      resultados.push({ type: "tool_result", tool_use_id: b.id, content: conteudo });
    }
    novo.push({ role: "user", content: resultados });
  }
  throw new Error("IA não concluiu a resposta");
}
