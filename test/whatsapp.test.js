import { test } from "node:test";
import assert from "node:assert/strict";
import { montarMensagem } from "../src/whatsapp.js";

test("WhatsApp: até 3 opções viram botões, mais viram lista, data é ignorada", () => {
  assert.equal(montarMensagem("oi").type, "text");
  const b = montarMensagem("Qual?", [{ rotulo: "Hoje", texto: "06/10/2026" }, { rotulo: "Escolher data", texto: "", tipo: "data" }]);
  assert.equal(b.interactive.type, "button");
  assert.deepEqual(b.interactive.action.buttons[0].reply, { id: "06/10/2026", title: "Hoje" });
  const l = montarMensagem("Qual?", [1, 2, 3, 4].map((n) => ({ rotulo: `${n} noites · até 1${n}/10 muito longo`, texto: `${n} noites` })));
  assert.equal(l.interactive.type, "list");
  assert.ok(l.interactive.action.sections[0].rows.every((r) => r.title.length <= 24));
});
