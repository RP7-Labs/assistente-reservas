import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gn-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
for (const v of ["META_DATASET_ID", "META_CAPI_TOKEN", "TTLOCK_CLIENT_ID"]) delete process.env[v];
Object.assign(process.env, {
  GETNET_CLIENT_ID: "cid", GETNET_CLIENT_SECRET: "csec", GETNET_SELLER_ID: "seller-1",
  GETNET_AMBIENTE: "homologacao", GETNET_SEGREDO_NOTIFICACAO: "segredo-de-teste-123",
});
const gn = await import("../src/getnet.js");
const store = await import("../src/store.js");
const { app } = await import("../src/app.js");

// Intercepta só as chamadas para a Getnet; o resto (o servidor local do teste) passa direto
const chamadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.includes("getnet.com.br")) return fetchOriginal(url, opts);
  chamadas.push({ url: u, opts, corpo: opts.body && !u.includes("/token") ? JSON.parse(opts.body) : opts.body });
  const json = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.endsWith("/auth/oauth/v2/token")) return json({ access_token: "tok-1", expires_in: 3600 });
  if (u.endsWith("/v2/payments/qrcode/pix")) return json({ payment_id: "pix-pay-1", status: "WAITING", additional_data: { qr_code: "00020101PIXREAL", expiration_date_qrcode: new Date(Date.now() + 1800_000).toISOString() } });
  if (u.endsWith("/v2/payments/capture")) return json({ payment_id: "card-pay-1", status: "CONFIRMED" });
  if (u.endsWith("/v2/payments/cancel")) return json({ payment_id: "card-pay-1", status: "CANCELED" });
  return json({ message: "não encontrado" }, 404);
};

test("config, centavos e token em cache", async () => {
  assert.equal(gn.configGetnet({}), null);
  const cfg = gn.configGetnet();
  assert.equal(cfg.api, "https://api-homologacao.getnet.com.br");
  assert.equal(gn.modoPagamento(), "getnet");
  assert.equal(gn.centavos(440.1), 44010);
  gn.limparCacheGetnet();
  const antes = chamadas.length;
  assert.equal(await gn.tokenGetnet(cfg), "tok-1");
  assert.equal(await gn.tokenGetnet(cfg), "tok-1");
  const tokens = chamadas.slice(antes).filter((c) => c.url.endsWith("/token"));
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].opts.headers.Authorization, "Basic " + Buffer.from("cid:csec").toString("base64"));
  assert.equal(tokens[0].opts.body, "scope=oob&grant_type=client_credentials");
});

test("notificação: segredo e tradução do status", () => {
  assert.ok(gn.segredoConfere("segredo-de-teste-123"));
  assert.ok(!gn.segredoConfere("segredo-errado-0000"));
  assert.ok(!gn.segredoConfere(""));
  assert.equal(gn.lerNotificacao({ payment_type: "pix", status: "APPROVED" }).novo, "pago");
  assert.equal(gn.lerNotificacao({ payment_type: "credit", status: "AUTHORIZED" }).novo, "pre_autorizado");
  assert.equal(gn.lerNotificacao({ payment_type: "credit", status: "CONFIRMED" }).novo, "capturado");
  assert.equal(gn.lerNotificacao({ payment_type: "credit", status: "DENIED" }).novo, "recusado");
  assert.equal(gn.lerNotificacao({ payment_type: "pix", status: "WAITING" }).novo, null);
});

test("Pix real: gera pela Getnet, confirma pela notificação e ignora notificação falsa", async () => {
  const lead = await store.criarLead({ canal: "web", conversa_id: "gn1", quarto_id: "suite", checkin: "2099-03-10", checkout: "2099-03-12", adultos: 2, criancas: 0, noites: 2 });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/pagamento`;
  const post = (p, b = {}) => fetch(`${base}/${lead.id}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  try {
    // Sem aceitar os termos não segue (CDC; Decreto 7.962/2013)
    assert.equal((await post("/dados", { nome: "Ana Souza", email: "ana@exemplo.com" })).status, 400);
    assert.equal((await post("/pix")).status, 400);
    assert.equal((await post("/dados", { nome: "Ana Souza", email: "ana@exemplo.com", aceite_termos: true })).status, 200);
    const [aceite] = await store.listarProvas({ referencias: [lead.id] });
    assert.equal(aceite.tipo, "aceite_reserva");
    assert.equal(aceite.dados.consente_anuncios, false);
    assert.equal(aceite.dados.pedido.checkin, "2099-03-10");
    // Com a Getnet ligada o número do cartão não pode chegar ao servidor
    assert.equal((await post("/cartao", { numero: "4111111111111111", validade: "12/30", cvv: "123", nome: "A" })).status, 400);
    assert.equal((await post("/pix/simular")).status, 404);

    const pix = await (await post("/pix")).json();
    assert.equal(pix.copia_e_cola, "00020101PIXREAL");
    assert.equal(pix.real, true);
    const req = chamadas.find((c) => c.url.endsWith("/qrcode/pix"));
    assert.equal(req.opts.headers["x-seller-id"], "seller-1");
    assert.equal(req.opts.headers["x-qrcode-expiration-time"], "1800");
    const pag = await store.buscarPagamento(lead.id);
    assert.equal(req.corpo.amount, Math.round(pag.valor * 100));
    assert.equal(req.corpo.order_id, lead.id);
    // Gerar de novo reaproveita o mesmo QR Code
    await post("/pix");
    assert.equal(chamadas.filter((c) => c.url.endsWith("/qrcode/pix")).length, 1);

    const notif = (segredo, q) => fetch(`${base}/getnet/notificacao/${segredo}?${new URLSearchParams(q)}`);
    const q = { payment_type: "pix", seller_id: "seller-1", order_id: lead.id, payment_id: "pix-pay-1", amount: String(Math.round(pag.valor * 100)), status: "APPROVED" };
    assert.equal((await notif("errado", q)).status, 404);
    await notif("segredo-de-teste-123", { ...q, amount: "1" });
    await notif("segredo-de-teste-123", { ...q, seller_id: "outro" });
    assert.equal((await store.buscarPagamento(lead.id)).status, "pendente");

    assert.equal((await notif("segredo-de-teste-123", q)).status, 200);
    const pago = await store.buscarPagamento(lead.id);
    assert.equal(pago.status, "pago");
    assert.equal(pago.provedor, "getnet");
    assert.ok(pago.codigo_reserva);
    // Reenvio da mesma notificação não cria outra reserva
    await notif("segredo-de-teste-123", q);
    const { reservas } = await store.listarDados();
    assert.equal(reservas.filter((r) => r.lead_id === lead.id).length, 1);
    const status = await (await fetch(`${base}/${lead.id}`)).json();
    assert.equal(status.provedor, "getnet");
    assert.equal(status.pagamento.status, "pago");
  } finally {
    srv.close();
  }
});

test("cartão real: iframe sem segredo, pré-autorização pela notificação e captura na Getnet", async () => {
  const lead = await store.criarLead({ canal: "web", conversa_id: "gn2", quarto_id: "suite", checkin: "2099-04-10", checkout: "2099-04-11", adultos: 1, criancas: 0, noites: 1 });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/pagamento`;
  const post = (p, b = {}) => fetch(`${base}/${lead.id}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  try {
    await post("/dados", { nome: "Bruno Lima Costa", email: "bruno@exemplo.com", telefone: "34999990000", aceite_termos: true, consente_anuncios: true });
    const cfg = await (await post("/cartao/getnet")).json();
    assert.equal(cfg.loader, "https://checkout-homologacao.getnet.com.br/loader.js");
    const a = cfg.atributos;
    assert.equal(a["data-getnet-token"], "Bearer tok-1");
    assert.equal(a["data-getnet-orderid"], lead.id);
    assert.equal(a["data-getnet-customer-last-name"], "Lima Costa");
    assert.equal(a["data-getnet-pre-authorization-credit"], "true");
    assert.match(a["data-getnet-amount"], /^\d+\.\d{2}$/);
    assert.ok(!JSON.stringify(cfg).includes("csec"));

    const pag = await store.buscarPagamento(lead.id);
    await fetch(`${base}/getnet/notificacao/segredo-de-teste-123?${new URLSearchParams({ payment_type: "credit", seller_id: "seller-1", order_id: lead.id, payment_id: "card-pay-1", amount: String(Math.round(pag.valor * 100)), status: "AUTHORIZED", brand: "Mastercard", authorization_code: "123456" })}`);
    const pre = await store.buscarPagamento(lead.id);
    assert.equal(pre.status, "pre_autorizado");
    assert.equal(pre.gateway_id, "card-pay-1");

    const { acaoGetnet } = await import("../src/pagamento.js");
    await acaoGetnet(pre, "capturar");
    const cap = chamadas.find((c) => c.url.endsWith("/v2/payments/capture"));
    assert.deepEqual(cap.corpo, { idempotency_key: `${lead.id}-capture`, payment_id: "card-pay-1", payment_method: "CREDIT_AUTHORIZATION", amount: Math.round(pag.valor * 100) });
    assert.equal(await acaoGetnet({ provedor: "simulado" }, "capturar"), null);
  } finally {
    srv.close();
  }
});
