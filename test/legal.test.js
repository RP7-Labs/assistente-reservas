// Conformidade: textos legais, provas imutáveis em corrente, aceite dos termos, menores e aluguel por temporada
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lg-")), "db.json");
delete process.env.SUPABASE_URL;
const legal = await import("../src/legal.js");
const store = await import("../src/store.js");
const { validarPedido } = await import("../src/catalogo.js");
const { validarLegal } = await import("../src/admin.js");

const completo = {
  nome: "Hotel Teste", checkin: "14:00", checkout: "11:00", politicas: "Sem pets.",
  empresa: { razao_social: "Hotel Teste Ltda", cnpj: "12345678000190", endereco: "Rua 1, 10", email: "a@b.com" },
  cancelamento: "Grátis até 7 dias antes; depois, sem reembolso.",
};

test("pendências: sem razão social, CNPJ, endereço e cancelamento não vende online", () => {
  const p = legal.pendenciasLegais({ nome: "X" });
  assert.ok(p.some((x) => x.campo === "empresa.cnpj" && x.bloqueia));
  assert.ok(p.some((x) => x.campo === "cancelamento" && x.bloqueia));
  assert.equal(legal.podeVenderOnline({ nome: "X" }), false);
  assert.equal(legal.podeVenderOnline(completo), true);
  // Temporada exige locador, imóvel e inventário (Lei 8.245/1991, art. 48)
  const casa = { ...completo, tipo: "temporada" };
  assert.equal(legal.podeVenderOnline(casa), false);
  assert.ok(legal.pendenciasLegais(casa).some((x) => x.campo === "temporada.inventario"));
});

test("textos: termos com vendedor e cancelamento; privacidade muda para temporada; versão muda com o texto", () => {
  const t = legal.textoTermosReserva(completo);
  assert.match(t, /Hotel Teste Ltda, CNPJ 12345678000190/);
  assert.match(t, /Grátis até 7 dias/);
  assert.match(t, /ECA, art\. 82/);
  assert.match(legal.textoPrivacidade(completo), /FNRH/);
  assert.doesNotMatch(legal.textoPrivacidade({ ...completo, tipo: "temporada" }), /Ministério do Turismo \(FNRH\)/);
  assert.notEqual(legal.versao(t), legal.versao(legal.textoTermosReserva({ ...completo, cancelamento: "Outra regra de cancelamento qualquer." })));
});

test("contrato de temporada: ocupantes, inventário, prazo e assinatura eletrônica", () => {
  const casa = { ...completo, tipo: "temporada", temporada: { locador: { nome: "Joel", documento: "52998224725" }, imovel: { endereco: "Rua 446" }, max_ocupantes: 6, inventario: [{ item: "Sofá", quantidade: 1, estado: "bom" }] } };
  const c = legal.textoContratoTemporada(casa, { reserva: { codigo_motor: "C-1", checkin: "2026-12-20", checkout: "2026-12-27" }, valor: 3500, hospedes: [{ nome: "Ana Souza", documento_tipo: "CPF", documento_numero: "52998224725", nascimento: "1990-01-01", email: "ana@x.com" }] });
  assert.match(c, /LOCADOR: Joel/);
  assert.match(c, /1 × Sofá – estado: bom/);
  assert.match(c, /20\/12\/2026/);
  assert.match(c, /1\. Ana Souza – CPF 52998224725/);
  assert.match(c, /MP 2\.200-2\/2001/);
  // Mais de 90 dias não é temporada
  const pedido = { quarto_id: "casa", checkin: "2027-01-01", checkout: "2027-05-01", adultos: 2 };
  const hotel = { tipo: "temporada", quartos: [{ id: "casa", nome: "Casa", capacidade_adultos: 6, capacidade_total: 6, preco_a_partir: 500 }] };
  assert.match(validarPedido(hotel, pedido, new Date("2026-10-13")).erro, /90 dias/);
  assert.equal(validarPedido(hotel, { ...pedido, checkout: "2027-01-10" }, new Date("2026-10-13")).ok, true);
});

test("provas: texto guardado uma vez, corrente de hashes e adulteração detectada", async () => {
  const req = { get: (h) => ({ "x-forwarded-for": "200.1.2.3, 10.0.0.1", "user-agent": "Teste/1.0" })[h], ip: "x" };
  const a = await legal.provar(req, { tipo: "aceite_reserva", referencia: "L1", titular: { email: "a@b.com" }, textoTipo: "termos_reserva", texto: "Termos v1" });
  const b = await legal.provar(req, { tipo: "aceite_reserva", referencia: "L2", textoTipo: "termos_reserva", texto: "Termos v1" });
  assert.equal(a.ip, "200.1.2.3");
  assert.equal(a.agente, "Teste/1.0");
  assert.equal(a.texto_hash, b.texto_hash);
  assert.equal(b.hash_anterior, a.hash);
  assert.equal((await store.buscarTextoLegal(a.texto_hash)).texto, "Termos v1");
  assert.equal(await store.verificarProvas(), null);
  // Alguém mexe no arquivo: a conferência acusa
  const db = JSON.parse(fs.readFileSync(process.env.LOCAL_DB_FILE, "utf8"));
  db.provas[0].referencia = "OUTRA";
  fs.writeFileSync(process.env.LOCAL_DB_FILE, JSON.stringify(db));
  assert.deepEqual(await store.verificarProvas(), { id: 1, problema: "conteúdo alterado" });
});

test("admin: valida dados legais e lê o inventário em linhas", () => {
  assert.match(validarLegal({ empresa: { cnpj: "123" } }).erro, /CNPJ/);
  const v = validarLegal({ tipo: "temporada", empresa: { cnpj: "12.345.678/0001-90" }, temporada: { max_ocupantes: "6", inventario: "Sofá; 1; bom\nPratos; 12\n\n" } });
  assert.equal(v.empresa.cnpj, "12345678000190");
  assert.deepEqual(v.temporada.inventario, [{ item: "Sofá", quantidade: 1, estado: "bom" }, { item: "Pratos", quantidade: 12, estado: "bom" }]);
  assert.equal(v.temporada.max_ocupantes, 6);
});
