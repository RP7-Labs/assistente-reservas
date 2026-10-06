import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "llm-")), "db.json");
delete process.env.SUPABASE_URL;
const { responderComLLM, extrairOpcoes, paraOpenAI, configLLM, promptSistema } = await import("../src/llm.js");
const { carregarHotel } = await import("../src/catalogo.js");
const { falas } = await import("../src/backoffice.js");

const cfg = { url: "https://falso", modelo: "m", chave: "k", provedor: "teste" };
// Simula a API: devolve as respostas da lista, uma por chamada, e guarda o que recebeu
function apiFalsa(respostas) {
  const recebidas = [];
  const fn = async (_url, opts) => {
    recebidas.push(JSON.parse(opts.body));
    const message = respostas.shift();
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
  return { fn, recebidas };
}

test("configuração escolhe o provedor gratuito", () => {
  assert.equal(configLLM({}), null);
  assert.equal(configLLM({ LLM_API_KEY: "x" }).modelo, "gemini-2.5-flash");
  assert.match(configLLM({ LLM_API_KEY: "x", LLM_PROVEDOR: "groq" }).url, /groq/);
});

test("opções no fim da resposta viram botões", () => {
  const r = extrairOpcoes("Qual quarto?\n[opções: Estúdio | Suíte | Escolher data]", "2026-10-06");
  assert.equal(r.texto, "Qual quarto?");
  assert.deepEqual(r.opcoes.map((o) => o.tipo ?? o.texto), ["Estúdio", "Suíte", "data"]);
});

test("ferramenta gera o link validado e o histórico continua legível no back-office", async () => {
  const { fn, recebidas } = apiFalsa([
    { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "gerar_link_reserva", arguments: JSON.stringify({ quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-22", adultos: 2, criancas: 0 }) } }] },
    { content: "Prontinho! Suíte de 20 a 22/10 para 2 adultos.\n[opções: Tirar uma dúvida | Falar com atendente]" },
  ]);
  const r = await responderComLLM({ historico: [], texto: "suíte de 20 a 22/10 pra 2", canal: "web", conversaId: "t1", publicUrl: "https://app", cfg, buscarFn: fn, hoje: "2026-10-06" });
  assert.equal(r.eventos[0].tipo, "link");
  assert.ok(r.resposta.includes(r.eventos[0].link)); // link sempre no texto
  assert.equal(r.opcoes.length, 2);
  // a segunda chamada recebeu o resultado da ferramenta no formato da API
  assert.equal(recebidas[1].messages.at(-1).role, "tool");
  assert.ok(falas(r.historico).some((f) => f.texto.startsWith("Link de reserva")));
  assert.equal(paraOpenAI(r.historico).length, 4);
});

test("pedido inválido volta como erro para a IA corrigir", async () => {
  const { fn, recebidas } = apiFalsa([
    { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "gerar_link_reserva", arguments: JSON.stringify({ quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-22", adultos: 4, criancas: 0 }) } }] },
    { content: "A suíte é para até 2 pessoas. O Quarto Família serve?" },
  ]);
  const r = await responderComLLM({ historico: [], texto: "suíte pra 4", canal: "web", conversaId: "t2", cfg, buscarFn: fn, hoje: "2026-10-06" });
  assert.match(recebidas[1].messages.at(-1).content, /comporta/);
  assert.equal(r.eventos.length, 0);
});

test("prompt traz a resposta da base e as datas do feriado", () => {
  const p = promptSistema(carregarHotel(), "aceita cachorro no natal?", "2026-10-06");
  assert.match(p, /animais de estimação/);
  assert.match(p, /entrada 2026-12-24, saída 2026-12-26/);
});
