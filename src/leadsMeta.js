// Leads dos formulários de anúncio da Meta (Lead Ads): a Meta avisa pelo webhook "leadgen",
// buscamos as respostas na Graph API e o assistente chama a pessoa no WhatsApp na hora,
// com um modelo de mensagem aprovado (a primeira mensagem para quem nunca escreveu precisa ser modelo).
// A conversa segue no fluxo normal do assistente, e a reserva paga volta para a Meta como conversão do lead.
import crypto from "node:crypto";
import { carregarHotel, noHotel, hotelPorIntegracao } from "./catalogo.js";
import {
  buscarLeadMeta, salvarLeadMeta, salvarOrigem, carregarConversa, salvarConversa, marcarAtendente,
} from "./store.js";
import { enviar, whatsappConfigurado } from "./whatsapp.js";
import { envDoHotel, HOTEL_PADRAO } from "./tenant.js";

export function configLeadsMeta(env = envDoHotel()) {
  return {
    token: env.META_PAGE_TOKEN || null,                 // token da página com a permissão leads_retrieval
    segredoApp: env.META_APP_SECRET || null,            // confere a assinatura do webhook
    verifyToken: env.META_LEADS_VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN || null,
    versao: env.META_API_VERSION || "v21.0",
    modelo: env.WHATSAPP_MODELO_LEAD || null,           // nome do modelo aprovado no WhatsApp Manager
    idioma: env.WHATSAPP_MODELO_IDIOMA || "pt_BR",
    textoModelo: env.WHATSAPP_MODELO_LEAD_TEXTO || null, // texto do modelo, só para o histórico da conversa
  };
}

// Assinatura X-Hub-Signature-256: HMAC SHA-256 do corpo bruto com o segredo do app
export function assinaturaValida(corpoBruto, cabecalho, segredo) {
  if (!segredo || !corpoBruto || !cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from("sha256=" + crypto.createHmac("sha256", segredo).update(corpoBruto).digest("hex"));
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

// Telefone no formato do WhatsApp (só dígitos, com DDI). Número brasileiro sem DDI ganha o 55.
export function telefoneWhatsapp(bruto) {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d.replace(/^0/, "");
  if (d.length === 12 && d.startsWith("0")) d = "55" + d.slice(1);
  return d.length >= 10 && d.length <= 15 ? d : null;
}

const CAMPOS_CONTATO = {
  nome: ["full_name", "nome_completo", "nome"],
  primeiro: ["first_name", "primeiro_nome"],
  sobrenome: ["last_name", "sobrenome"],
  telefone: ["phone_number", "telefone", "celular", "whatsapp"],
  email: ["email", "e-mail"],
};
const chaveCampo = (s) => String(s ?? "").trim().toLowerCase();

// Separa contato (nome, telefone, e-mail) das perguntas próprias do formulário
export function lerCampos(fieldData = []) {
  const valores = Object.fromEntries(fieldData.map((f) => [chaveCampo(f.name), (f.values ?? []).join(", ").trim()]));
  const pegar = (lista) => lista.map((c) => valores[c]).find(Boolean) ?? null;
  const usados = new Set(Object.values(CAMPOS_CONTATO).flat());
  const nome = pegar(CAMPOS_CONTATO.nome) ?? ([pegar(CAMPOS_CONTATO.primeiro), pegar(CAMPOS_CONTATO.sobrenome)].filter(Boolean).join(" ") || null);
  const respostas = fieldData
    .filter((f) => !usados.has(chaveCampo(f.name)) && (f.values ?? []).length)
    .map((f) => ({ pergunta: String(f.name).replace(/_/g, " ").replace(/\?$/, ""), resposta: f.values.join(", ") }));
  return { nome, telefone: pegar(CAMPOS_CONTATO.telefone), email: pegar(CAMPOS_CONTATO.email), respostas };
}

// Busca o lead completo na Graph API (o webhook só traz o id)
export async function buscarLeadNaMeta(leadgenId, cfg = configLeadsMeta(), buscarFn = fetch) {
  if (!cfg.token) throw new Error("falta META_PAGE_TOKEN");
  const campos = "created_time,field_data,ad_id,ad_name,adset_name,campaign_name,form_id,platform";
  const r = await buscarFn(`https://graph.facebook.com/${cfg.versao}/${encodeURIComponent(leadgenId)}?fields=${campos}&access_token=${encodeURIComponent(cfg.token)}`, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta ${r.status}: ${j.error?.message ?? "falha ao ler o lead"}`);
  const c = lerCampos(j.field_data);
  return {
    id: String(j.id ?? leadgenId), criado_meta: j.created_time ?? null, ...c,
    form_id: j.form_id ?? null, ad_id: j.ad_id ?? null, ad_nome: j.ad_name ?? null,
    campanha: j.campaign_name ?? null, conjunto: j.adset_name ?? null, plataforma: j.platform ?? null,
  };
}

const primeiroNome = (nome) => String(nome ?? "").trim().split(/\s+/)[0] || "tudo bem";
const textoPadrao = (lead, hotel) =>
  `Olá, ${primeiroNome(lead.nome)}! Aqui é do ${hotel.nome}. Recebemos seu interesse pelo anúncio e posso te ajudar agora mesmo por aqui. Para quando você está pensando em vir e por quanto tempo?`;
const corporativo = (lead) => /\b(empresa|corporativ\w*|cnpj|equipe|funcion[aá]rios?)\b/i.test(lead.respostas?.map((r) => r.resposta).join(" ") ?? "");

// O que a pessoa respondeu no formulário entra na conversa como primeira fala dela:
// o assistente já sabe datas, tempo de estadia e motivo e não pergunta de novo.
export function falaDoFormulario(lead) {
  if (!lead.respostas?.length) return null;
  return "(Respostas do formulário do anúncio) " + lead.respostas.map((r) => `${r.pergunta}: ${r.resposta}`).join(". ");
}

// Manda o modelo aprovado no WhatsApp e prepara a conversa
export async function contatarLead(lead, { cfg = configLeadsMeta(), buscarFn = fetch, hotel = carregarHotel() } = {}) {
  const tel = telefoneWhatsapp(lead.telefone);
  const tentativas = (lead.tentativas ?? 0) + 1;
  if (!tel) return salvarLeadMeta({ ...lead, status: "sem_telefone", erro: "Formulário sem telefone válido" });
  if (!cfg.modelo) return salvarLeadMeta({ ...lead, status: "sem_modelo", erro: "Falta WHATSAPP_MODELO_LEAD (modelo aprovado)" });
  const msg = {
    type: "template",
    template: { name: cfg.modelo, language: { code: cfg.idioma }, components: [{ type: "body", parameters: [{ type: "text", text: primeiroNome(lead.nome) }] }] },
  };
  const r = await enviar(tel, msg, buscarFn);
  if (!r.ok) return salvarLeadMeta({ ...lead, tentativas, status: r.simulado ? "sem_whatsapp" : "falha_envio", erro: r.erro });
  // O WhatsApp devolve o wa_id, que é o número que vai aparecer quando a pessoa responder
  const conversaId = `wa:${r.waId ?? tel}`;
  const historico = await carregarConversa(conversaId).catch(() => []);
  if (!historico.length) {
    const texto = (cfg.textoModelo ?? textoPadrao(lead, hotel)).replace("{{1}}", primeiroNome(lead.nome));
    const fala = falaDoFormulario(lead);
    await salvarConversa(conversaId, "whatsapp", [
      { role: "user", content: fala ?? "(Lead do formulário do anúncio, sem respostas extras)" },
      { role: "assistant", content: [{ type: "text", text: texto }] },
    ]);
  }
  await salvarOrigem({
    conversa_id: conversaId, canal: "whatsapp", utm_source: "meta", utm_medium: "lead_ads",
    utm_campaign: lead.campanha, utm_content: lead.ad_nome, ad_id: lead.ad_id, meta_lead_id: lead.id,
  }).catch((err) => console.error("origem do lead:", err.message));
  if (corporativo(lead)) await marcarAtendente(conversaId, true, "Lead corporativo do formulário da Meta").catch(() => {});
  return salvarLeadMeta({ ...lead, telefone: tel, conversa_id: conversaId, tentativas, status: "contatado", contatado_em: new Date().toISOString(), erro: null });
}

// Lead novo (do webhook ou de teste): grava e chama. Repetição do mesmo lead não manda de novo.
export async function receberLead(dados, opcoes = {}) {
  const atual = await buscarLeadMeta(dados.id);
  if (atual && atual.status === "contatado") return atual;
  const lead = await salvarLeadMeta({ ...(atual ?? {}), ...dados, status: atual?.status ?? "novo" });
  return contatarLead(lead, opcoes);
}

// Leads que vieram no webhook, com a página de origem (cada hotel tem a sua página)
export function leadsDoWebhook(corpo) {
  if (corpo?.object !== "page") return [];
  return (corpo.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => ({ c, pagina: c.value?.page_id ?? e.id })))
    .filter(({ c }) => c.field === "leadgen" && c.value?.leadgen_id)
    .map(({ c, pagina }) => ({ id: String(c.value.leadgen_id), pagina: pagina != null ? String(pagina) : null }));
}
export const idsDoWebhook = (corpo) => leadsDoWebhook(corpo).map((l) => l.id);

// Página cadastrada num hotel; senão, o hotel padrão (que usa as variáveis de ambiente)
const hotelDaPagina = async (pagina) => (await hotelPorIntegracao("meta_page_id", pagina)) ?? HOTEL_PADRAO;

export function rotasLeadsMeta(app) {
  app.get("/webhook/meta-leads", (req, res) => {
    const { verifyToken } = configLeadsMeta();
    const ok = verifyToken && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken;
    return ok ? res.send(req.query["hub.challenge"]) : res.sendStatus(403);
  });

  app.post("/webhook/meta-leads", async (req, res) => {
    // O app da Meta é um só para a plataforma: o segredo dele vem das variáveis de ambiente.
    // Com o segredo configurado, só aceita o que a Meta assinou. Sem ele, um id falso
    // também não passa: o lead é sempre lido na Graph API com o token da página.
    const segredoApp = process.env.META_APP_SECRET;
    if (segredoApp && !assinaturaValida(req.rawBody, req.get("x-hub-signature-256"), segredoApp)) return res.sendStatus(401);
    // Processa antes de responder: na Vercel a função é congelada depois da resposta
    for (const { id, pagina } of leadsDoWebhook(req.body)) {
      await noHotel(await hotelDaPagina(pagina), async () => {
        try {
          const dados = await buscarLeadNaMeta(id, configLeadsMeta());
          await receberLead(dados);
        } catch (err) {
          console.error("Lead da Meta:", id, err.message);
          await salvarLeadMeta({ id, status: "novo", erro: err.message }).catch(() => {});
        }
      });
    }
    res.sendStatus(200);
  });
}

export const modoLeadsMeta = () => {
  const c = configLeadsMeta();
  if (!c.token) return { estado: "pendente", detalhe: "falta META_PAGE_TOKEN (token da página com leads_retrieval)" };
  if (!c.modelo) return { estado: "pendente", detalhe: "falta WHATSAPP_MODELO_LEAD (modelo aprovado no WhatsApp)" };
  if (!whatsappConfigurado()) return { estado: "pendente", detalhe: "WhatsApp não configurado" };
  return { estado: "ok", detalhe: `leads chamados no WhatsApp com o modelo ${c.modelo}` };
};
