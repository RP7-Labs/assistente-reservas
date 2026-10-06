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

test("conversa passo a passo pergunta só o que falta, com botões", () => {
  const oi = conversa("oi");
  assert.match(oi.texto, /Como posso ajudar/);
  assert.ok(oi.opcoes.some((o) => o.texto === "Fazer uma reserva"));
  const q = conversa("oi", "Fazer uma reserva");
  assert.deepEqual(q.opcoes.slice(0, 3).map((o) => o.texto), ["Estúdio", "Suíte", "Quarto Família"]);
  const d = conversa("oi", "Fazer uma reserva", "Suíte");
  assert.match(d.texto, /chegada|entrada/);
  assert.ok(d.opcoes.some((o) => o.tipo === "data"));
  assert.match(conversa("oi", "suíte", "dia 20").texto, /Entrada terça, 20\/10/);
  const p = conversa("oi", "suíte", "dia 20", "3 noites");
  assert.match(p.texto, /pessoas/);
  // botões de pessoas respeitam a capacidade da suíte (2 pessoas)
  assert.ok(p.opcoes.every((o) => !/3 adultos|2 adultos \+/.test(o.rotulo)));
  const r = conversa("oi", "suíte", "dia 20", "3 noites", "2");
  assert.deepEqual(r.acao.pedido, { quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-23", adultos: 2, criancas: 0 });
});

test("dúvidas respondem pela base de conhecimento, sem perder a reserva", () => {
  assert.match(conversa("aceita cachorro?").texto, /animais de estimação/);
  assert.match(conversa("tem piscina?").texto, /Não encontrei/);
  const r = conversa("suíte dia 20", "tem garagem?");
  assert.match(r.texto, /estacionamento[\s\S]*Voltando à sua reserva: Entrada terça/i);
  const t = conversa("Dúvidas sobre o hotel");
  assert.ok(t.opcoes.some((o) => o.texto === "Wi-Fi"));
  assert.match(conversa("Dúvidas sobre o hotel", "Wi-Fi").texto, /gratuito/);
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

test("intervalo com mês nas duas datas", () => {
  assert.deepEqual(extrairDatas("de 10/11 a 12/11", HOJE).datas, ["2026-11-10", "2026-11-12"]);
  assert.deepEqual(extrairDatas("de 30/12/2026 a 01/01/2027", HOJE).datas, ["2026-12-30", "2027-01-01"]);
});
