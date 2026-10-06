import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarHotel } from "../src/catalogo.js";
import { responderPorRegras, extrairDatas } from "../src/regras.js";

const hotel = carregarHotel();
const HOJE = "2026-10-06"; // terça
const conversa = (...m) => responderPorRegras(hotel, m, HOJE);

test("pedido completo em uma mensagem gera link do quarto pedido", () => {
  const r = conversa("quero o estúdio de 10 a 12/10 para 2 adultos");
  assert.equal(r.acao.tipo, "link");
  assert.deepEqual(r.acao.pedido, { quarto_id: "estudio", checkin: "2026-10-10", checkout: "2026-10-12", adultos: 2, criancas: 0 });
});

test("conversa passo a passo pergunta só o que falta", () => {
  assert.match(conversa("oi").texto, /Qual quarto/);
  assert.match(conversa("oi", "suíte").texto, /entrada/);
  assert.match(conversa("oi", "suíte", "dia 20").texto, /saída/);
  assert.match(conversa("oi", "suíte", "dia 20", "3 noites").texto, /Quantas pessoas/);
  const r = conversa("oi", "suíte", "dia 20", "3 noites", "2");
  assert.deepEqual(r.acao.pedido, { quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-23", adultos: 2, criancas: 0 });
});

test("grupo que não cabe recebe sugestão e pergunta outro quarto", () => {
  const r = conversa("suíte de 10/10 a 12/10 para 2 adultos e 2 crianças");
  assert.equal(r.acao, null);
  assert.match(r.texto, /Quarto Família/);
  assert.equal(conversa("suíte de 10/10 a 12/10 para 2 adultos e 2 crianças", "família").acao.pedido.quarto_id, "familia");
});

test("datas relativas e por extenso", () => {
  assert.deepEqual(extrairDatas("amanha", HOJE).datas, ["2026-10-07"]);
  assert.deepEqual(extrairDatas("sexta", HOJE).datas, ["2026-10-09"]);
  assert.deepEqual(extrairDatas("de 3 a 5 de janeiro", HOJE).datas, ["2027-01-03", "2027-01-05"]);
  assert.deepEqual(extrairDatas("dia 2", HOJE).datas, ["2026-11-02"]);
});

test("pedido de atendente é encaminhado", () => {
  assert.equal(conversa("quero falar com um atendente").acao.tipo, "atendente");
  assert.equal(conversa("orçamento para um casamento").acao.tipo, "atendente");
});
