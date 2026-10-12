// Teste de conexão de cada integração, com uma chamada real e sem efeito colateral (nada é cobrado,
// enviado ou gravado). Usado pelo admin para validar as chaves de sandbox/homologação antes de ir para produção.
import { configGetnet, tokenGetnet, limparCacheGetnet } from "./getnet.js";
import { configTTLock, listarFechadurasTTLock, limparCacheToken } from "./fechaduras.js";
import { configFNRH } from "./fnrh.js";
import { envDoHotel, simulacaoPermitida } from "./tenant.js";

const curto = (s) => String(s ?? "").slice(0, 200);

async function json(r) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { texto: t }; }
}

export const TESTES = {
  // Pede um token OAuth: confirma client id/secret e o ambiente (sandbox, homologação ou produção)
  async getnet(buscarFn) {
    const cfg = configGetnet();
    if (!cfg) return { ok: false, detalhe: "Faltam GETNET_CLIENT_ID, GETNET_CLIENT_SECRET e GETNET_SELLER_ID." };
    limparCacheGetnet();
    await tokenGetnet(cfg, buscarFn);
    return { ok: true, detalhe: `Token obtido na Getnet (${cfg.ambiente}).${cfg.notificacao ? "" : " Falta GETNET_SEGREDO_NOTIFICACAO para confirmar pagamentos."}`, ambiente: cfg.ambiente };
  },
  // Lista as fechaduras da conta: confirma o app da TTLock/TTHotel e o login
  async fechaduras(buscarFn) {
    const cfg = configTTLock();
    if (!cfg) return { ok: false, detalhe: "Faltam TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME e TTLOCK_PASSWORD." };
    limparCacheToken();
    const lista = await listarFechadurasTTLock(cfg, buscarFn);
    const semGateway = lista.filter((f) => !f.gateway).length;
    return { ok: true, detalhe: `${lista.length} fechadura(s) na conta${semGateway ? `, ${semGateway} sem gateway (não recebem senha pela internet)` : ""}.` };
  },
  // Lê o número de WhatsApp na Graph API: confirma token e phone number id (não envia mensagem)
  async whatsapp(buscarFn) {
    const { WHATSAPP_TOKEN: t, WHATSAPP_PHONE_NUMBER_ID: id } = envDoHotel();
    if (!t || !id) return { ok: false, detalhe: "Faltam WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID." };
    const r = await buscarFn(`https://graph.facebook.com/v21.0/${encodeURIComponent(id)}?fields=display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) });
    const j = await json(r);
    if (!r.ok) return { ok: false, detalhe: `Meta ${r.status}: ${curto(j.error?.message ?? j.texto)}` };
    return { ok: true, detalhe: `Número ${j.display_phone_number ?? id}${j.verified_name ? ` (${j.verified_name})` : ""}${j.quality_rating ? `, qualidade ${j.quality_rating}` : ""}.` };
  },
  // Lista os domínios da conta na Resend: confirma a chave e se o domínio do remetente está verificado
  async email(buscarFn) {
    const chave = process.env.RESEND_API_KEY, de = envDoHotel().EMAIL_FROM;
    if (!chave || !de) return { ok: false, detalhe: "Faltam RESEND_API_KEY e EMAIL_FROM." };
    const r = await buscarFn("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(15_000) });
    const j = await json(r);
    // Chave só de envio não lista domínios, mas está válida
    if (r.status === 401 && j.name === "restricted_api_key") return { ok: true, detalhe: "Chave de envio válida (sem permissão para listar domínios; confira na Resend se o domínio está verificado)." };
    if (!r.ok) return { ok: false, detalhe: `Resend ${r.status}: ${curto(j.message ?? j.texto)}` };
    const dominio = String(de).match(/@([^>\s]+)/)?.[1]?.toLowerCase();
    const d = (j.data ?? []).find((x) => x.name?.toLowerCase() === dominio);
    if (dominio === "resend.dev") return { ok: true, detalhe: "Chave válida. Remetente de teste resend.dev: só entrega no e-mail do dono da conta Resend." };
    if (!d) return { ok: false, detalhe: `Chave válida, mas o domínio ${dominio ?? "do EMAIL_FROM"} não está cadastrado na Resend.` };
    return { ok: d.status === "verified", detalhe: `Domínio ${d.name}: ${d.status === "verified" ? "verificado" : `status ${d.status} (falta verificar o DNS)`}.` };
  },
  // A FNRH não tem uma consulta sem efeito documentada para testar: só confere a configuração.
  // O teste real é registrar uma ficha em homologação (FNRH_AMBIENTE=homologacao, o padrão).
  async fnrh() {
    const cfg = configFNRH();
    if (!cfg) return { ok: false, detalhe: "Faltam FNRH_USUARIO, FNRH_SENHA e FNRH_CPF_SOLICITANTE." };
    return { ok: true, parcial: true, detalhe: `Configurada para ${cfg.ambiente}. Para validar, conclua um pré-check-in de teste e veja o status na aba Check-in.` };
  },
};

export async function testarIntegracao(nome, buscarFn = fetch) {
  if (!TESTES[nome]) return { ok: false, detalhe: "Integração desconhecida." };
  try {
    return { nome, ...(await TESTES[nome](buscarFn)), simulacao_permitida: simulacaoPermitida() };
  } catch (err) {
    return { nome, ok: false, detalhe: curto(err.message), simulacao_permitida: simulacaoPermitida() };
  }
}
