// Tráfego pago: guarda de onde veio cada conversa (UTM, clique do Google ou da Meta, anúncio do WhatsApp)
// e devolve as conversões para as plataformas, para as campanhas otimizarem por reserva paga.
// Meta: API de Conversões (servidor), deduplicada com o Pixel do navegador pelo mesmo event_id.
// Google Ads: tag do navegador na página de pagamento e um CSV de conversões offline pelo gclid.
import crypto from "node:crypto";
import { buscarOrigem, salvarOrigem, registrarConversao, buscarConversao, buscarLead } from "./store.js";
import { envDoHotel } from "./tenant.js";

const CAMPOS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "gbraid", "wbraid", "fbclid", "fbp", "ctwa_clid", "ad_id"];
// meta_lead_id não vem do navegador: só o webhook de leads grava (src/leadsMeta.js)
const limpar = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);

// Configuração pública (vai para o navegador): IDs, nunca tokens
export function configPublica(env = envDoHotel()) {
  return {
    meta_pixel: env.META_DATASET_ID || null,
    google_ads: env.GOOGLE_ADS_ID || null,                 // AW-123456789
    google_compra: env.GOOGLE_ADS_ROTULO_COMPRA || null,   // rótulo da ação de conversão "Compra"
    google_lead: env.GOOGLE_ADS_ROTULO_LEAD || null,
  };
}

// Normaliza o que o navegador mandou (parâmetros da URL de entrada, cookies _fbp, referrer)
export function normalizarOrigem(bruto = {}, req) {
  const o = {};
  for (const c of CAMPOS) o[c] = limpar(bruto[c]);
  o.referrer = limpar(bruto.referrer, 300);
  o.landing = limpar(bruto.landing, 300);
  // fbc no formato da Meta: fb.1.<momento do clique em ms>.<fbclid>
  o.fbc = limpar(bruto.fbc) || (o.fbclid ? `fb.1.${Number(bruto.fbclid_em) || Date.now()}.${o.fbclid}` : null);
  if (req) {
    o.ip = limpar((req.get("x-forwarded-for") ?? req.ip ?? "").split(",")[0], 60);
    o.user_agent = limpar(req.get("user-agent"), 300);
  }
  if (!o.utm_source) {
    if (o.gclid || o.gbraid || o.wbraid) Object.assign(o, { utm_source: "google", utm_medium: o.utm_medium || "cpc" });
    else if (o.fbclid) Object.assign(o, { utm_source: "meta", utm_medium: o.utm_medium || "paid_social" });
    else if (o.ctwa_clid) Object.assign(o, { utm_source: "meta", utm_medium: "whatsapp_ads" });
  }
  return o;
}

const temCampanha = (o) => CAMPOS.some((c) => c !== "fbp" && o[c]);

// Guarda a origem da conversa. Um clique novo de campanha substitui o anterior (último clique);
// visitas sem campanha não apagam a origem que já existe.
export async function registrarOrigem(conversaId, canal, origem) {
  if (!conversaId || !origem) return null;
  const atual = await buscarOrigem(conversaId).catch(() => null);
  if (atual && !temCampanha(origem)) {
    // Só completa o que faltava (ex.: o cookie _fbp aparece depois)
    const extras = Object.fromEntries(["fbp", "ip", "user_agent"].filter((c) => origem[c] && !atual[c]).map((c) => [c, origem[c]]));
    return Object.keys(extras).length ? salvarOrigem({ conversa_id: conversaId, ...extras }) : atual;
  }
  if (!atual && !temCampanha(origem) && !origem.referrer) return null;
  return salvarOrigem({ conversa_id: conversaId, canal, ...origem });
}

// Anúncio de clique para o WhatsApp: a Meta manda o objeto "referral" na primeira mensagem
export function origemWhatsapp(m) {
  const r = m?.referral;
  if (!r) return null;
  return normalizarOrigem({ ctwa_clid: r.ctwa_clid, ad_id: r.source_type === "ad" ? r.source_id : null, utm_campaign: r.headline, landing: r.source_url });
}

// Fonte legível para os relatórios
export function fonte(o) {
  if (!o) return "direto";
  if (o.utm_source) return o.utm_source.toLowerCase();
  if (o.referrer) { try { return new URL(o.referrer).hostname.replace(/^www\./, ""); } catch { /* referrer inválido */ } }
  return "direto";
}

const sha256 = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");
const telefoneE164 = (t) => { const d = String(t ?? "").replace(/\D/g, ""); return d.length >= 10 && d.length <= 11 ? `55${d}` : d; };

export function configMeta(env = envDoHotel()) {
  if (!env.META_DATASET_ID || !env.META_CAPI_TOKEN) return null;
  return { dataset: env.META_DATASET_ID, token: env.META_CAPI_TOKEN, versao: env.META_API_VERSION || "v21.0", teste: env.META_TEST_EVENT_CODE || null, waba: env.META_WABA_ID || null };
}

// Monta o evento da API de Conversões. Veio de anúncio de WhatsApp → business_messaging; senão → website.
export function eventoMeta({ evento, eventId, origem, pessoa = {}, valor, url, quando = new Date(), waba }) {
  const base = { event_name: evento, event_time: Math.floor(quando.getTime() / 1000), event_id: eventId };
  const custom = valor != null ? { currency: "BRL", value: Number(valor) } : undefined;
  if (origem?.ctwa_clid && waba) {
    return { ...base, action_source: "business_messaging", messaging_channel: "whatsapp", user_data: { whatsapp_business_account_id: waba, ctwa_clid: origem.ctwa_clid }, custom_data: custom };
  }
  const user = {};
  // Lead de formulário da Meta: evento de CRM ligado ao lead_id (integração "Conversion Leads")
  if (origem?.meta_lead_id) {
    if (pessoa.email) user.em = [sha256(pessoa.email)];
    if (pessoa.telefone) user.ph = [sha256(telefoneE164(pessoa.telefone))];
    return { ...base, action_source: "system_generated", user_data: { lead_id: origem.meta_lead_id, ...user },
      custom_data: { ...custom, event_source: "crm", lead_event_source: "Assistente de reservas" } };
  }
  if (pessoa.email) user.em = [sha256(pessoa.email)];
  if (pessoa.telefone) user.ph = [sha256(telefoneE164(pessoa.telefone))];
  if (pessoa.nome) { const [fn, ...ln] = pessoa.nome.trim().split(/\s+/); user.fn = [sha256(fn)]; if (ln.length) user.ln = [sha256(ln.at(-1))]; }
  if (origem?.fbc) user.fbc = origem.fbc;
  if (origem?.fbp) user.fbp = origem.fbp;
  if (origem?.ip) user.client_ip_address = origem.ip;
  if (origem?.user_agent) user.client_user_agent = origem.user_agent;
  return { ...base, action_source: "website", event_source_url: url, user_data: user, custom_data: custom };
}

// Envia uma conversão para a Meta uma única vez por event_id
export async function enviarMeta({ evento, eventId, leadId, valor, pessoa, url }, { cfg = configMeta(), buscarFn = fetch } = {}) {
  if (!cfg) return { enviado: false, motivo: "Meta não configurada" };
  const ja = await buscarConversao("meta", evento, eventId).catch(() => null);
  if (ja?.ok) return { enviado: false, motivo: "já enviado" };
  const lead = leadId ? await buscarLead(leadId) : null;
  const origem = lead ? await buscarOrigem(lead.conversa_id).catch(() => null) : null;
  const dados = eventoMeta({ evento, eventId, origem, pessoa, valor, url, waba: cfg.waba });
  const corpo = { data: [dados], ...(cfg.teste ? { test_event_code: cfg.teste } : {}) };
  let ok = false, resposta;
  try {
    const r = await buscarFn(`https://graph.facebook.com/${cfg.versao}/${cfg.dataset}/events?access_token=${encodeURIComponent(cfg.token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10_000),
    });
    resposta = (await r.text()).slice(0, 500);
    ok = r.ok;
  } catch (err) {
    resposta = err.message;
  }
  await registrarConversao({ plataforma: "meta", evento, event_id: eventId, lead_id: leadId ?? null, valor: valor ?? null, ok, resposta }).catch((e) => console.error(e));
  return { enviado: ok, resposta };
}

// CSV no formato de importação de conversões offline do Google Ads (por gclid)
export function csvGoogleAds(linhas, nomeConversao = "Reserva paga") {
  const data = (iso) => {
    // yyyy-MM-dd HH:mm:ss no horário de Brasília (o fuso vai na linha Parameters)
    const d = new Date(iso);
    const sp = new Date(d.getTime() - 3 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
    return sp;
  };
  const cab = "Parameters:TimeZone=-0300\nGoogle Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency";
  const corpo = linhas.filter((l) => l.gclid).map((l) => [l.gclid, nomeConversao, data(l.quando), Number(l.valor).toFixed(2), "BRL"].join(","));
  return [cab, ...corpo].join("\n") + "\n";
}
