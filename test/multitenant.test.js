import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mt-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_API_KEY;
Object.assign(process.env, {
  SESSION_SECRET: "segredo-de-teste-longo-123", ADMIN_EMAIL: "dono@plataforma.com",
  GETNET_CLIENT_ID: "id", GETNET_CLIENT_SECRET: "seg", GETNET_SELLER_ID: "sel",
  FNRH_USUARIO: "u", FNRH_SENHA: "s", FNRH_CPF_SOLICITANTE: "12345678909",
});
const { app } = await import("../src/app.js");
const store = await import("../src/store.js");
const { noHotel, carregarHotel } = await import("../src/catalogo.js");
const { dinheiro, hojeNoFuso } = await import("../src/paises.js");
const { configGetnet } = await import("../src/getnet.js");
const { configFNRH } = await import("../src/fnrh.js");

const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const api = async (rota, { metodo = "GET", corpo, token, hotel } = {}) => {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(hotel ? { "X-Hotel": hotel } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: "manual",
  });
  return { status: r.status, corpo: await r.json().catch(() => null), local: r.headers.get("location") };
};
const entrar = async (email, senha) => (await api("/api/admin/entrar", { metodo: "POST", corpo: { email, senha } })).corpo?.token;

test.after(() => srv.close());

test("moeda e data no padrão de cada país", () => {
  assert.equal(dinheiro(1234.5, { idioma: "pt-BR", moeda: "BRL" }).replace(/\s/g, " "), "R$ 1.234,50");
  assert.match(dinheiro(1234.5, { idioma: "es-AR", moeda: "ARS" }), /1\.234,50/);
  assert.match(dinheiro(150000, { idioma: "es-PY", moeda: "PYG" }), /150\.000/);
  assert.equal(dinheiro(1234.5, { idioma: "en-US", moeda: "USD" }), "$1,234.50");
  // 02:00 UTC ainda é o dia anterior em Nova York e em São Paulo
  assert.equal(hojeNoFuso("America/New_York", new Date("2026-10-10T02:00:00Z")), "2026-10-09");
  assert.equal(hojeNoFuso("Europe/Lisbon", new Date("2026-10-10T02:00:00Z")), "2026-10-10");
});

test("plataforma cria hotéis, cada hotel vê só os próprios dados", async () => {
  await api("/api/admin/cadastro", { metodo: "POST", corpo: { nome: "Dono", email: "dono@plataforma.com", senha: "senha12345" } });
  const dono = await entrar("dono@plataforma.com", "senha12345");
  assert.ok(dono);

  const criado = await api("/api/admin/hoteis", { metodo: "POST", token: dono, corpo: { id: "hotel-bsas", nome: "Hotel Palermo", pais: "AR", cidade: "Buenos Aires", dominios: "reservas.palermo.com.ar" } });
  assert.equal(criado.status, 201);
  assert.equal((await api("/api/admin/hoteis", { metodo: "POST", token: dono, corpo: { id: "X inválido", nome: "a" } })).status, 400);
  const lista = (await api("/api/admin/hoteis", { token: dono })).corpo;
  assert.deepEqual(lista.hoteis.map((h) => h.id).sort(), ["hotel-bsas", "principal"]);
  assert.equal(lista.paises.US, "Estados Unidos");

  // Chat público por cabeçalho ou ?hotel=, e hotel desconhecido dá 404
  assert.equal((await api("/api/hotel", { hotel: "hotel-bsas" })).corpo.nome, "Hotel Palermo");
  assert.equal((await api("/api/hotel?hotel=hotel-bsas")).corpo.nome, "Hotel Palermo");
  assert.notEqual((await api("/api/hotel")).corpo.nome, "Hotel Palermo");
  assert.equal((await api("/api/hotel", { hotel: "nao-existe" })).status, 404);

  // Padrões do país
  const h = await noHotel("hotel-bsas", () => carregarHotel());
  assert.deepEqual([h.pais, h.moeda, h.idioma, h.fuso], ["AR", "ARS", "es-AR", "America/Argentina/Buenos_Aires"]);

  // Dados separados: o lead do hotel argentino não aparece no principal
  const lead = await noHotel("hotel-bsas", () => store.criarLead({ canal: "web", conversa_id: "c-ar", quarto_id: "x", checkin: "2030-01-10", checkout: "2030-01-12", adultos: 2, criancas: 0 }));
  assert.ok(await noHotel("hotel-bsas", () => store.buscarLead(lead.id)));
  assert.equal(await noHotel("principal", () => store.buscarLead(lead.id)), undefined);
  assert.equal(await store.localizarHotel("leads", "id", lead.id), "hotel-bsas");

  // Links com id próprio acham o hotel sozinhos
  const r = await api(`/r/${lead.id}`);
  assert.equal(r.status, 302);
  const pg = await api(`/api/pagamento/${lead.id}`);
  assert.equal(pg.corpo.pedido.hotel, "Hotel Palermo");
  assert.equal(pg.corpo.pedido.moeda, "ARS");
  assert.equal(pg.corpo.provedor, "simulado"); // a Getnet do hotel principal não vale para outro hotel
});

test("admin de um hotel não entra em outro; admin da plataforma troca de hotel", async () => {
  const cad = await api("/api/admin/cadastro", { metodo: "POST", hotel: "hotel-bsas", corpo: { nome: "Gerente", email: "gerente@palermo.com", senha: "senha12345" } });
  assert.equal(cad.status, 201);
  assert.equal((await api("/api/admin/cadastro", { metodo: "POST", corpo: { nome: "Outro", email: "gerente@palermo.com", senha: "senha12345" } })).status, 409);

  const dono = await entrar("dono@plataforma.com", "senha12345");
  const usuarios = (await api("/api/admin/usuarios", { token: dono, hotel: "hotel-bsas" })).corpo;
  const gerente = usuarios.find((a) => a.email === "gerente@palermo.com");
  assert.ok(gerente, "o pedido aparece no hotel certo");
  assert.ok(!(await api("/api/admin/usuarios", { token: dono })).corpo.some((a) => a.email === "gerente@palermo.com"));
  assert.equal((await api(`/api/admin/usuarios/${gerente.id}/aprovar`, { metodo: "POST", token: dono, hotel: "hotel-bsas" })).status, 200);

  const tokGerente = await entrar("gerente@palermo.com", "senha12345");
  const eu = (await api("/api/admin/eu", { token: tokGerente })).corpo;
  assert.equal(eu.hotel.id, "hotel-bsas");
  assert.equal(eu.plataforma, false);
  assert.equal((await api("/api/admin/eu", { token: tokGerente, hotel: "principal" })).status, 403);
  assert.equal((await api("/api/admin/hoteis", { token: tokGerente })).status, 403);

  const euDono = (await api("/api/admin/eu", { token: dono, hotel: "hotel-bsas" })).corpo;
  assert.equal(euDono.hotel.nome, "Hotel Palermo");
  assert.equal(euDono.plataforma, true);
});

test("integrações do Brasil ficam desligadas fora do Brasil", async () => {
  assert.ok(await noHotel("principal", () => configGetnet()));
  assert.ok(await noHotel("principal", () => configFNRH()));
  assert.equal(await noHotel("hotel-bsas", () => configGetnet()), null);
  assert.equal(await noHotel("hotel-bsas", () => configFNRH()), null);
});
