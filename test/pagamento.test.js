import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pag-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
const { validarCartao, luhn, enviarLembretes } = await import("../src/pagamento.js");
const store = await import("../src/store.js");

test("cartão: Luhn, validade e cartão de recusa", () => {
  const agora = new Date("2026-10-06T12:00:00Z");
  assert.ok(luhn("4111111111111111"));
  assert.equal(validarCartao({ numero: "4111 1111 1111 1111", validade: "12/30", cvv: "123", nome: "A" }, agora).final, "1111");
  assert.match(validarCartao({ numero: "4111111111111112", validade: "12/30", cvv: "123", nome: "A" }, agora).erro, /inválido/);
  assert.match(validarCartao({ numero: "4111111111111111", validade: "09/26", cvv: "123", nome: "A" }, agora).erro, /vencido/);
  assert.ok(validarCartao({ numero: "4000000000000002", validade: "12/30", cvv: "123", nome: "A" }, agora).recusado);
});

test("lembrete por e-mail sai uma vez, só depois de 5 minutos sem pagar", async () => {
  const lead = await store.criarLead({ canal: "web", conversa_id: "x", quarto_id: "suite", checkin: "2099-01-10", checkout: "2099-01-12", adultos: 2, criancas: 0, noites: 2 });
  const inicio = new Date("2026-10-06T12:00:00Z");
  await store.salvarPagamento({ lead_id: lead.id, nome: "Ana", email: "ana@exemplo.com", status: "pendente", iniciado_em: inicio.toISOString(), valor: 440 });
  assert.equal((await enviarLembretes("https://x.app", new Date(inicio.getTime() + 4 * 60_000))).enviados, 0);
  assert.equal((await enviarLembretes("https://x.app", new Date(inicio.getTime() + 6 * 60_000))).enviados, 1);
  assert.equal((await enviarLembretes("https://x.app", new Date(inicio.getTime() + 9 * 60_000))).enviados, 0);
  const [email] = await store.listarEmails();
  assert.equal(email.para, "ana@exemplo.com");
  assert.equal(email.provedor, "simulado");
  assert.ok(email.corpo.includes(`https://x.app/pagamento?lead=${lead.id}`));
});

test("pagamento já feito não recebe lembrete", async () => {
  const lead = await store.criarLead({ canal: "web", conversa_id: "y", quarto_id: "suite", checkin: "2099-01-10", checkout: "2099-01-12", adultos: 2, criancas: 0, noites: 2 });
  await store.salvarPagamento({ lead_id: lead.id, nome: "Bia", email: "bia@exemplo.com", status: "pago", iniciado_em: "2026-10-06T12:00:00Z" });
  assert.equal((await enviarLembretes("https://x.app", new Date("2026-10-06T13:00:00Z"))).enviados, 0);
});
