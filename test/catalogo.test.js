import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarHotel, validarPedido, montarLinkMotor } from "../src/catalogo.js";

const hotel = carregarHotel();
const hoje = new Date("2026-10-05T12:00:00Z");
const base = { checkin: "2026-10-20", checkout: "2026-10-22", adultos: 2, criancas: 0 };

test("estúdio pedido gera link do estúdio, não da suíte", () => {
  const v = validarPedido(hotel, { quarto_id: "estudio", ...base }, hoje);
  assert.equal(v.ok, true);
  assert.equal(v.noites, 2);
  const link = montarLinkMotor(hotel, v.quarto, base, "abc");
  assert.match(link, /quarto=EST/);
  assert.doesNotMatch(link, /quarto=SUI/);
  assert.match(link, /utm_source=assistente/);
  assert.match(link, /utm_content=abc/);
});

test("grupo maior que a capacidade é recusado e sugere quartos que cabem", () => {
  const v = validarPedido(hotel, { quarto_id: "suite", ...base, adultos: 2, criancas: 1 }, hoje);
  assert.equal(v.ok, false);
  assert.match(v.erro, /Estúdio/);
});

test("datas inválidas", () => {
  assert.equal(validarPedido(hotel, { quarto_id: "suite", ...base, checkout: "2026-10-19" }, hoje).ok, false);
  assert.equal(validarPedido(hotel, { quarto_id: "suite", ...base, checkin: "2026-02-30" }, hoje).ok, false);
  assert.equal(validarPedido(hotel, { quarto_id: "suite", ...base, checkin: "2026-10-01" }, hoje).ok, false);
});

test("quarto inexistente", () => {
  assert.equal(validarPedido(hotel, { quarto_id: "presidencial", ...base }, hoje).ok, false);
});
