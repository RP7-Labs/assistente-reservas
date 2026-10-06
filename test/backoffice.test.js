import { test } from "node:test";
import assert from "node:assert/strict";
import { montarLocacoes, disponibilidade, falas, indicadores, resumoAtendimento } from "../src/backoffice.js";
import { carregarHotel } from "../src/catalogo.js";

const hoje = "2026-10-06";
const leads = [
  { id: "a", canal: "web", conversa_id: "c1", quarto_id: "estudio", checkin: "2026-10-20", checkout: "2026-10-22", adultos: 2, criancas: 0, criado_em: "2026-10-05T10:00:00Z" },
  { id: "b", canal: "whatsapp", conversa_id: "c2", quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-21", adultos: 1, criancas: 0, criado_em: "2026-10-05T11:00:00Z" },
  { id: "c", canal: "web", conversa_id: "c3", quarto_id: "suite", checkin: "2026-10-01", checkout: "2026-10-02", adultos: 2, criancas: 0, criado_em: "2026-09-28T11:00:00Z" },
  { id: "d", canal: "web", conversa_id: "c4", quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-23", adultos: 2, criancas: 0, criado_em: "2026-10-05T12:00:00Z" },
];
const cliques = [{ lead_id: "b", em: "2026-10-05T11:05:00Z" }, { lead_id: "a", em: "2026-10-05T10:02:00Z" }];
const reservas = [
  { codigo_motor: "G1", lead_id: "a", quarto_id: "estudio", checkin: "2026-10-20", checkout: "2026-10-22", status: "confirmada", valor: "560.00", criado_em: "2026-10-05T10:10:00Z" },
  { codigo_motor: "M1", lead_id: null, quarto_id: "suite", checkin: "2026-10-19", checkout: "2026-10-21", status: "confirmada", valor: "440", criado_em: "2026-10-04T10:00:00Z" },
];

test("status de cada locação segue o funil", () => {
  const l = Object.fromEntries(montarLocacoes(leads, cliques, reservas, hoje).map((x) => [x.lead_id ?? x.codigo_motor, x.status]));
  assert.deepEqual(l, { a: "confirmada", b: "clicou", c: "nao_convertido", d: "link_enviado", M1: "confirmada" });
});

test("disponibilidade conta reservas ativas e links em processo na data", () => {
  const hotel = carregarHotel();
  const d = Object.fromEntries(disponibilidade(hotel, reservas, leads, "2026-10-20").map((q) => [q.id, q]));
  assert.equal(d.estudio.ocupadas, 1);
  assert.equal(d.estudio.livres, d.estudio.unidades - 1);
  assert.equal(d.estudio.em_processo, 0); // lead "a" já virou reserva
  assert.equal(d.suite.ocupadas, 1); // reserva manual M1
  assert.equal(d.suite.em_processo, 2); // leads b e d
  // checkout não ocupa
  assert.equal(disponibilidade(hotel, reservas, leads, "2026-10-22").find((q) => q.id === "estudio").ocupadas, 0);
});

test("falas legíveis a partir do histórico da API", () => {
  const m = [
    { role: "user", content: "Quero o estúdio" },
    { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "tool_use", name: "gerar_link_reserva", input: { quarto_id: "estudio", checkin: "2026-10-20", checkout: "2026-10-22", adultos: 2, criancas: 0 } }] },
    { role: "user", content: [{ type: "tool_result", content: "{}" }] },
    { role: "assistant", content: [{ type: "text", text: "Aqui está o link!" }] },
  ];
  const f = falas(m);
  assert.equal(f.length, 3);
  assert.equal(f[1].autor, "sistema");
  const r = resumoAtendimento({ id: "x", mensagens: m });
  assert.equal(r.gerou_link, true);
  assert.equal(r.mensagens, 1);
  assert.match(r.ultima, /^Assistente: Aqui/);
});

test("indicadores calculam conversão e comissão economizada", () => {
  const loc = montarLocacoes(leads, cliques, reservas, hoje);
  const i = indicadores([], loc);
  assert.equal(i.links_gerados, 4);
  assert.equal(i.reservas_do_assistente, 1);
  assert.equal(i.receita_assistente, 560);
  assert.equal(i.comissao_economizada, 84);
  assert.equal(i.conversao, 0.25);
});
