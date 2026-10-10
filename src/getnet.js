// Getnet (Santander): Pix pela API v2 e cartão pelo Checkout Iframe da Getnet, para o número do cartão
// nunca passar pelo nosso servidor. A captura e o cancelamento da pré-autorização são feitos pela API v2.
// Sem GETNET_CLIENT_ID, GETNET_CLIENT_SECRET e GETNET_SELLER_ID, o checkout continua simulado.
import crypto from "node:crypto";
import { envDoHotel } from "./tenant.js";
import { carregarHotel } from "./catalogo.js";

const AMBIENTES = {
  sandbox: { api: "https://api-sandbox.getnet.com.br", iframe: "https://checkout-sandbox.getnet.com.br/loader.js" },
  homologacao: { api: "https://api-homologacao.getnet.com.br", iframe: "https://checkout-homologacao.getnet.com.br/loader.js" },
  // URL de produção do iframe não está na documentação pública: confirmar com a Getnet
  producao: { api: "https://api.getnet.com.br", iframe: "https://checkout.getnet.com.br/loader.js" },
};

export function configGetnet(env = envDoHotel(), pais = carregarHotel().pais) {
  // A Getnet atende só no Brasil; nos outros países o checkout fica simulado até ter o provedor local
  if (pais && pais !== "BR") return null;
  const { GETNET_CLIENT_ID: id, GETNET_CLIENT_SECRET: segredo, GETNET_SELLER_ID: seller } = env;
  if (!id || !segredo || !seller) return null;
  const ambiente = AMBIENTES[env.GETNET_AMBIENTE] ? env.GETNET_AMBIENTE : "homologacao";
  return {
    ambiente, id, segredo, seller,
    api: (env.GETNET_API_URL || AMBIENTES[ambiente].api).replace(/\/$/, ""),
    iframe: env.GETNET_IFRAME_URL || AMBIENTES[ambiente].iframe,
    canal: env.GETNET_CANAL || "XX",                         // x-transaction-channel-entry: pedir o código à Getnet
    notificacao: env.GETNET_SEGREDO_NOTIFICACAO || null,     // parte secreta da URL de notificação
    preAutorizacao: env.GETNET_PRE_AUTORIZACAO !== "0",
  };
}
export const modoPagamento = () => (configGetnet() ? "getnet" : "simulado");

export const centavos = (v) => Math.round(Number(v) * 100);

let cache = null;
export const limparCacheGetnet = () => { cache = null; };

export async function tokenGetnet(cfg = configGetnet(), buscarFn = fetch) {
  if (cache && cache.chave === cfg.id + cfg.api && cache.expira > Date.now()) return cache.token;
  const r = await buscarFn(`${cfg.api}/auth/oauth/v2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${cfg.id}:${cfg.segredo}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ scope: "oob", grant_type: "client_credentials" }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Getnet token ${r.status}: ${j.error_description ?? j.message ?? "falha"}`);
  cache = { chave: cfg.id + cfg.api, token: j.access_token, expira: Date.now() + Math.max(60, (j.expires_in ?? 3300) - 300) * 1000 };
  return cache.token;
}

async function chamar(cfg, caminho, corpo, { buscarFn = fetch, extras = {} } = {}) {
  const token = await tokenGetnet(cfg, buscarFn);
  const r = await buscarFn(`${cfg.api}${caminho}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-seller-id": cfg.seller, "x-transaction-channel-entry": cfg.canal, ...extras },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const det = j.details?.[0];
    throw new Error(`Getnet ${r.status}: ${det?.description_detail ?? det?.description ?? j.message ?? j.name ?? "falha"}`);
  }
  return j;
}

// Pix: gera o QR Code. A confirmação chega pela notificação da Getnet.
export async function criarPix({ pedidoId, valor, clienteId, tentativa = 1 }, cfg = configGetnet(), buscarFn = fetch) {
  const j = await chamar(cfg, "/v2/payments/qrcode/pix", {
    idempotency_key: `${pedidoId}-pix-${tentativa}`, amount: centavos(valor), currency: "BRL", order_id: pedidoId, customer_id: clienteId,
  }, { buscarFn, extras: { "x-qrcode-expiration-time": "1800" } });
  if (!j.payment_id || !j.additional_data?.qr_code) throw new Error(`Getnet não devolveu o QR Code (${j.status ?? "sem status"})`);
  return { paymentId: j.payment_id, copiaECola: j.additional_data.qr_code, expiraEm: j.additional_data.expiration_date_qrcode ?? null, status: j.status };
}

// Captura a pré-autorização (cobra de fato) ou cancela (libera o limite do cartão)
export async function capturarCartao({ pedidoId, paymentId, valor }, cfg = configGetnet(), buscarFn = fetch) {
  const j = await chamar(cfg, "/v2/payments/capture", { idempotency_key: `${pedidoId}-capture`, payment_id: paymentId, payment_method: "CREDIT_AUTHORIZATION", amount: centavos(valor) }, { buscarFn });
  if (!["CONFIRMED", "CAPTURED", "APPROVED"].includes(j.status)) throw new Error(`Getnet não capturou (${j.status ?? "sem status"})`);
  return j;
}

export async function cancelarCartao({ pedidoId, paymentId, valor }, cfg = configGetnet(), buscarFn = fetch) {
  const corpo = { idempotency_key: `${pedidoId}-void`, payment_id: paymentId, payment_method: "CREDIT_AUTHORIZATION", amount: centavos(valor) };
  const j = await chamar(cfg, "/v2/payments/cancel", corpo, { buscarFn });
  if (j.status === "DENIED") throw new Error("Getnet recusou o cancelamento");
  return j;
}

// Dados que a página usa para abrir o Checkout Iframe da Getnet (valor em reais com ponto, não em centavos)
export async function configIframe({ pedidoId, valor, pag, hotel, descricao }, cfg = configGetnet(), buscarFn = fetch) {
  const [primeiro, ...resto] = String(pag.nome ?? "").trim().split(/\s+/);
  return {
    loader: cfg.iframe,
    atributos: {
      "data-getnet-sellerid": cfg.seller,
      // Token de curta duração gerado no servidor; o segredo nunca vai para o navegador
      "data-getnet-token": `Bearer ${await tokenGetnet(cfg, buscarFn)}`,
      "data-getnet-amount": Number(valor).toFixed(2),
      "data-getnet-customerid": pag.email,
      "data-getnet-orderid": pedidoId,
      "data-getnet-installments": "1",
      "data-getnet-button-class": "pay-button-getnet",
      "data-getnet-customer-first-name": primeiro ?? "",
      "data-getnet-customer-last-name": resto.join(" "),
      "data-getnet-customer-email": pag.email,
      "data-getnet-customer-phone-number": String(pag.telefone ?? "").replace(/\D/g, ""),
      "data-getnet-items": JSON.stringify([{ name: descricao.slice(0, 60), description: hotel.nome, value: Number(valor), quantity: 1, sku: pedidoId }]),
      "data-getnet-url-callback": "",
      ...(cfg.preAutorizacao ? { "data-getnet-pre-authorization-credit": "true" } : {}),
    },
  };
}

// Compara o segredo da URL de notificação em tempo constante
export function segredoConfere(recebido, cfg = configGetnet()) {
  if (!cfg?.notificacao || !recebido) return false;
  const a = Buffer.from(String(recebido)), b = Buffer.from(cfg.notificacao);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Traduz a notificação da Getnet para o status do nosso pagamento
export function lerNotificacao(q) {
  const status = String(q.status ?? "").toUpperCase();
  const tipo = String(q.payment_type ?? "").toLowerCase();
  const pix = tipo.includes("pix") || Boolean(q.transaction_id && !q.authorization_code && !q.brand);
  let novo = null;
  if (pix && status === "APPROVED") novo = "pago";
  else if (!pix && status === "AUTHORIZED") novo = "pre_autorizado";
  else if (!pix && ["APPROVED", "CONFIRMED", "CAPTURED"].includes(status)) novo = "capturado";
  else if (status === "CANCELED") novo = "liberado";
  else if (["DENIED", "ERROR"].includes(status)) novo = "recusado";
  return {
    metodo: pix ? "pix" : "cartao", status, novo,
    pedidoId: q.order_id ?? null, paymentId: q.payment_id ?? null, sellerId: q.seller_id ?? null,
    valor: q.amount != null ? Number(q.amount) : null, bandeira: q.brand ?? null, autorizacao: q.authorization_code ?? null,
    detalhe: q.description_detail ?? null,
  };
}
