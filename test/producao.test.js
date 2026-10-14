// Comportamento em produção com o catálogo real do hotel: nada simulado, nada de preço inventado
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOTEL_FILE = path.join(import.meta.dirname, "..", "data", "hotel.json");
process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prod-")), "db.json");
process.env.VERCEL_ENV = "production";
delete process.env.SIMULACAO;
delete process.env.SUPABASE_URL;
for (const v of ["GETNET_CLIENT_ID", "TTLOCK_CLIENT_ID", "FNRH_USUARIO"]) delete process.env[v];

const { simulacaoPermitida } = await import("../src/tenant.js");
const { modoPagamento } = await import("../src/getnet.js");
const { carregarHotel, validarPedido, temPreco } = await import("../src/catalogo.js");
const { responderPorRegras } = await import("../src/regras.js");
const store = await import("../src/store.js");
const ck = await import("../src/checkin.js");

test("em produção a simulação fica desligada, a menos que SIMULACAO=1", () => {
  assert.equal(simulacaoPermitida(), false);
  assert.equal(modoPagamento(), "indisponivel");
  process.env.SIMULACAO = "1";
  assert.equal(modoPagamento(), "simulado");
  delete process.env.SIMULACAO;
});

test("catálogo real: tabela do Joel por pessoa e por temporada; sem tabela, chama a equipe", () => {
  const hotel = carregarHotel();
  assert.deepEqual(hotel.quartos.map((q) => q.id), ["estudio", "suite"]);
  assert.equal(hotel.quartos.reduce((t, q) => t + q.unidades, 0), 29);
  const suite = hotel.quartos.find((q) => q.id === "suite");
  // Baixa: R$ 99 por pessoa → casal, 2 noites = 396
  const baixa = validarPedido(hotel, { quarto_id: "suite", checkin: "2026-11-10", checkout: "2026-11-12", adultos: 2 }, new Date("2026-10-12T12:00:00Z"));
  assert.equal(baixa.total, 396);
  // Réveillon (500) e Carnaval 2027 (6 a 9/02, 299) por pessoa
  assert.equal(validarPedido(hotel, { quarto_id: "suite", checkin: "2026-12-30", checkout: "2027-01-02", adultos: 2 }, new Date("2026-10-12T12:00:00Z")).total, 3000);
  assert.equal(validarPedido(hotel, { quarto_id: "suite", checkin: "2027-02-05", checkout: "2027-02-07", adultos: 2 }, new Date("2026-10-12T12:00:00Z")).total, 169 * 2 + 299 * 2);
  const r = responderPorRegras(hotel, ["quero a suíte de 10/11 a 12/11 para 2 adultos"], "2026-10-12");
  assert.match(r.texto, /R\$ 396/);
  const lista = responderPorRegras(hotel, ["Ver quartos e preços"], "2026-10-12");
  assert.match(lista.texto, /a partir de R\$ 99 por pessoa/i);
  // Sem tabela e sem diária: não gera link e chama a equipe, sem inventar valor
  const semTabela = { ...hotel, tarifas: null };
  assert.equal(temPreco(suite, 2, semTabela), false);
  assert.equal(validarPedido(semTabela, { quarto_id: "suite", checkin: "2026-11-10", checkout: "2026-11-12", adultos: 2 }, new Date("2026-10-12T12:00:00Z")).sem_preco, true);
  const sr = responderPorRegras(semTabela, ["quero a suíte de 10/11 a 12/11 para 2 adultos"], "2026-10-12");
  assert.equal(sr.acao?.tipo, "atendente");
  assert.doesNotMatch(sr.texto, /R\$/);
  assert.equal(temPreco({ ...suite, preco_a_partir: 200 }), true);
});

test("tarifas: texto do admin ida e volta", async () => {
  const { lerTarifas, tarifasParaTexto } = await import("../src/catalogo.js");
  const hotel = carregarHotel();
  const volta = lerTarifas(tarifasParaTexto(hotel.tarifas), true).tarifas;
  assert.deepEqual(volta.faixas, hotel.tarifas.faixas);
  assert.equal(volta.padrao, 99);
  assert.deepEqual(volta.eventos.map((e) => e.nome), ["Réveillon", "Carnaval"]);
  assert.match(lerTarifas("Natal 24/12 a 25/12: 1.200,50", false).tarifas.eventos[0].valor.toString(), /^1200\.5$/);
  assert.match(lerTarifas("dezembro: 100", true).erro, /linha 1/);
});

test("check-in sem fechadura em produção não inventa senha", async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await store.salvarReserva({ codigo_motor: "PROD-1", quarto_id: "suite", checkin: hoje, checkout: amanha, adultos: 1, criancas: 0, valor: 200, status: "confirmada", hospede: "Ana" });
  await store.salvarUnidade({ numero: "101", quarto_id: "suite", lock_id: null });
  const r = await ck.emitirSenha("PROD-1", { cfg: null });
  assert.equal(r.senha, null);
  assert.equal(r.senha_status, "sem_fechadura");
  assert.match(r.senha_erro, /não configurada/);
});
