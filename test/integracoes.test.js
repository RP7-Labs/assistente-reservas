import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "int-")), "db.json");
process.env.SESSION_SECRET = "segredo-de-teste-123456";
delete process.env.SUPABASE_URL;
for (const v of ["GETNET_CLIENT_ID", "TTLOCK_CLIENT_ID", "WHATSAPP_TOKEN", "RESEND_API_KEY", "FNRH_USUARIO"]) delete process.env[v];
const { testarIntegracao } = await import("../src/integracoes.js");
const store = await import("../src/store.js");
const { criarToken } = await import("../src/auth.js");
const { app } = await import("../src/app.js");
const { carregarHotel, validarPedido } = await import("../src/catalogo.js");

const resposta = (status, corpo) => ({ ok: status < 300, status, text: async () => JSON.stringify(corpo), json: async () => corpo });

test("sem chaves, o teste diz o que falta", async () => {
  for (const n of ["getnet", "fechaduras", "whatsapp", "email", "fnrh"]) {
    const r = await testarIntegracao(n, () => { throw new Error("não deveria chamar"); });
    assert.equal(r.ok, false);
    assert.match(r.detalhe, /Falta/);
  }
});

test("WhatsApp e Resend: lê o número e o domínio, sem enviar nada", async () => {
  process.env.WHATSAPP_TOKEN = "t"; process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  const chamadas = [];
  const w = await testarIntegracao("whatsapp", async (url, o) => { chamadas.push([url, o?.method ?? "GET"]); return resposta(200, { display_phone_number: "+55 47 9999-0000", verified_name: "Rezende" }); });
  assert.equal(w.ok, true);
  assert.match(w.detalhe, /Rezende/);
  assert.equal(chamadas[0][1], "GET");
  const erro = await testarIntegracao("whatsapp", async () => resposta(401, { error: { message: "Invalid OAuth access token" } }));
  assert.equal(erro.ok, false);
  assert.match(erro.detalhe, /Invalid OAuth/);
  process.env.RESEND_API_KEY = "re_x"; process.env.EMAIL_FROM = "Hotel <reservas@hotel.com.br>";
  assert.equal((await testarIntegracao("email", async () => resposta(200, { data: [{ name: "hotel.com.br", status: "verified" }] }))).ok, true);
  assert.equal((await testarIntegracao("email", async () => resposta(200, { data: [{ name: "hotel.com.br", status: "pending" }] }))).ok, false);
  assert.equal((await testarIntegracao("email", async () => resposta(401, { name: "restricted_api_key" }))).ok, true);
  for (const v of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "RESEND_API_KEY", "EMAIL_FROM"]) delete process.env[v];
});

test("Getnet: pede token no ambiente configurado", async () => {
  Object.assign(process.env, { GETNET_CLIENT_ID: "id", GETNET_CLIENT_SECRET: "s", GETNET_SELLER_ID: "seller", GETNET_AMBIENTE: "sandbox" });
  let url;
  const r = await testarIntegracao("getnet", async (u) => { url = u; return resposta(200, { access_token: "tok", expires_in: 3600 }); });
  assert.equal(r.ok, true);
  assert.match(url, /api-sandbox\.getnet/);
  const f = await testarIntegracao("getnet", async () => resposta(401, { error_description: "invalid client" }));
  assert.equal(f.ok, false);
  for (const v of ["GETNET_CLIENT_ID", "GETNET_CLIENT_SECRET", "GETNET_SELLER_ID", "GETNET_AMBIENTE"]) delete process.env[v];
});

const servidor = http.createServer(app);
await new Promise((ok) => servidor.listen(0, ok));
const base = `http://127.0.0.1:${servidor.address().port}/api/admin`;
const adm = await store.criarAdmin({ nome: "Teste", email: "teste@exemplo.com", senha_hash: "x", status: "aprovado" });
const cab = { "Content-Type": "application/json", Authorization: `Bearer ${criarToken(adm.id)}` };

test("catálogo: valida, salva no cadastro do hotel, vale para o assistente e vai para a auditoria", async () => {
  const put = (b) => fetch(base + "/catalogo", { method: "PUT", headers: cab, body: JSON.stringify(b) });
  assert.equal((await fetch(base + "/catalogo")).status, 401);
  const atual = await fetch(base + "/catalogo", { headers: cab }).then((r) => r.json());
  assert.ok(atual.quartos.length);
  assert.equal((await put({ quartos: [] })).status, 400);
  assert.equal((await put({ quartos: [{ id: "x", nome: "X", capacidade_adultos: 3, capacidade_total: 2, unidades: 1 }] })).status, 400);
  assert.equal((await put({ quartos: [{ id: "x", nome: "X", capacidade_adultos: 2, capacidade_total: 2, unidades: 1, preco_a_partir: -5 }] })).status, 400);
  assert.equal((await put({ quartos: [{ id: "x", nome: "X", capacidade_adultos: 2, capacidade_total: 2, unidades: 1 }], link_motor: "http://inseguro" })).status, 400);
  const ok = await put({ quartos: [
    { id: "suite", nome: "Suíte", capacidade_adultos: 3, capacidade_total: 3, unidades: 20, preco_a_partir: "189.90", apelidos: "suite, quarto" },
    { id: "estudio", nome: "Smart Studio", capacidade_adultos: 2, capacidade_total: 2, unidades: 9, preco_a_partir: null, preco_mensal: 2800 },
  ], politicas: "Sem pets." });
  assert.equal(ok.status, 200);
  const h = carregarHotel();
  assert.equal(h.quartos.find((q) => q.id === "suite").preco_a_partir, 189.9);
  assert.equal(h.politicas, "Sem pets.");
  const d = { checkin: "2030-01-10", checkout: "2030-01-12", adultos: 2 };
  assert.equal(validarPedido(h, { ...d, quarto_id: "suite" }).ok, true);
  assert.equal(validarPedido(h, { ...d, quarto_id: "estudio" }).sem_preco, true);
  assert.equal(validarPedido(h, { quarto_id: "estudio", checkin: "2030-01-01", checkout: "2030-01-31", adultos: 1 }).ok, true); // mensal tem preço
  assert.ok((await store.listarAuditoria()).some((a) => a.acao === "alterou catálogo e preços"));
});

test("teste de integração pelo admin exige login", async () => {
  assert.equal((await fetch(base + "/integracoes/getnet/testar", { method: "POST" })).status, 401);
  const r = await fetch(base + "/integracoes/getnet/testar", { method: "POST", headers: cab }).then((x) => x.json());
  assert.equal(r.ok, false);
  assert.equal((await fetch(base + "/integracoes/nada/testar", { method: "POST", headers: cab })).status, 404);
});

test.after(() => servidor.close());
