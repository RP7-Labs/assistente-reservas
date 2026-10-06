import { test } from "node:test";
import assert from "node:assert/strict";
import { pascoa, sugerirPeriodo } from "../src/periodos.js";
import { carregarHotel } from "../src/catalogo.js";
import { responderPorRegras } from "../src/regras.js";

const HOJE = "2026-10-06";

test("páscoa e carnaval caem nas datas certas", () => {
  assert.equal(pascoa(2026).toISOString().slice(0, 10), "2026-04-05");
  assert.equal(pascoa(2027).toISOString().slice(0, 10), "2027-03-28");
  const c = sugerirPeriodo("carnaval", HOJE);
  assert.deepEqual(c.opcoes[0], { checkin: "2027-02-06", checkout: "2027-02-10" }); // sábado a quarta de cinzas
});

test("feriado que já passou neste ano vai para o próximo", () => {
  assert.equal(sugerirPeriodo("tiradentes", HOJE).opcoes[0].checkin.slice(0, 4), "2027");
  assert.equal(sugerirPeriodo("natal", HOJE).opcoes[0].checkin, "2026-12-24");
});

test("feriado no domingo emenda o fim de semana", () => {
  // 15/11/2026 é domingo: sábado a segunda
  assert.deepEqual(sugerirPeriodo("feriado de 15 de novembro", HOJE).opcoes[0], { checkin: "2026-11-14", checkout: "2026-11-16" });
});

test("chat oferece as opções e aceita o número escolhido", () => {
  const hotel = carregarHotel();
  const r1 = responderPorRegras(hotel, ["suíte no natal para casal"], HOJE);
  assert.equal(r1.opcoes.length, 3);
  assert.match(r1.texto, /1\) 24\/12 a 26\/12/);
  const r2 = responderPorRegras(hotel, ["suíte no natal para casal", "2"], HOJE);
  assert.deepEqual(r2.acao.pedido, { quarto_id: "suite", checkin: "2026-12-23", checkout: "2026-12-26", adultos: 2, criancas: 0 });
  // clicar no botão manda o texto da opção
  const r3 = responderPorRegras(hotel, ["suíte no natal para casal", r1.opcoes[2].texto], HOJE);
  assert.equal(r3.acao.pedido.checkout, "2026-12-27");
});
