// Envio da senha (WhatsApp e horário configurável), assinatura e leitura de documento (MRZ)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pngAssinatura } from "./fixtures/assinatura.js";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "se-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
for (const v of ["TTLOCK_CLIENT_ID", "WHATSAPP_MODELO_SENHA"]) delete process.env[v];
Object.assign(process.env, { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "999" });
const ck = await import("../src/checkin.js");
const store = await import("../src/store.js");
const { carregarHotel } = await import("../src/catalogo.js");
await import("../public/mrz.js");

const titular = { nome: "Ana Souza", email: "ana@exemplo.com", telefone: "47999990000", pais_residencia: "BR" };

test("número do WhatsApp no formato internacional", () => {
  assert.equal(ck.numeroWhatsapp({ telefone: "(47) 99999-0000", pais_residencia: "BR" }), "5547999990000");
  assert.equal(ck.numeroWhatsapp({ telefone: "5547999990000", pais_residencia: "BR" }), "5547999990000");
  assert.equal(ck.numeroWhatsapp({ telefone: "5491122334455", pais_residencia: "AR" }), "5491122334455");
  assert.equal(ck.numeroWhatsapp({ telefone: "123", pais_residencia: "AR" }), null);
});

test("senha vai no WhatsApp: texto simples ou modelo aprovado", async () => {
  const hotel = carregarHotel();
  const reserva = { codigo_motor: "W-1" };
  const c = { hospedes: [titular], unidade: "101", senha: "482913", senha_inicio: "2026-12-20T17:00:00Z", senha_fim: "2026-12-22T14:00:00Z" };
  let corpo;
  const buscar = async (_u, o) => { corpo = JSON.parse(o.body); return { ok: true, json: async () => ({}) }; };
  assert.equal((await ck.whatsappSenha(hotel, reserva, c, buscar)).ok, true);
  assert.equal(corpo.to, "5547999990000");
  assert.match(corpo.text.body, /482913#/);
  process.env.WHATSAPP_MODELO_SENHA = "senha_porta";
  await ck.whatsappSenha(hotel, reserva, c, buscar);
  assert.equal(corpo.type, "template");
  assert.equal(corpo.template.name, "senha_porta");
  assert.deepEqual(corpo.template.components[0].parameters.map((p) => p.text).slice(0, 3), ["Ana", "101", "482913#"]);
  delete process.env.WHATSAPP_MODELO_SENHA;
});

test("horário de envio: na hora por padrão ou X horas antes do check-in", () => {
  const reserva = { checkin: "2026-12-20", checkout: "2026-12-22" };
  assert.equal(ck.momentoEnvioSenha({ checkin: "14:00" }, reserva), null);
  const q = ck.momentoEnvioSenha({ checkin: "14:00", senha_envio: { modo: "antes_checkin", horas_antes: 24 } }, reserva);
  assert.equal(q.toISOString(), "2026-12-19T17:00:00.000Z"); // 14h de Brasília menos 24h
});

test("tarefa agendada entrega a senha quando chega a hora e avisa por e-mail e WhatsApp", async () => {
  await store.salvarReserva({ codigo_motor: "AG-1", quarto_id: "suite", checkin: "2026-12-20", checkout: "2026-12-22", hospede: "Ana Souza", status: "confirmada" });
  await store.salvarUnidade({ numero: "301", quarto_id: "suite" });
  const c = await ck.garantirCheckin("AG-1");
  await store.salvarCheckin({ ...c, hospedes: [titular], status: "concluido", senha_status: "agendada", senha_envio_em: "2026-12-19T17:00:00.000Z" });
  const enviados = [];
  const buscar = async (u, o) => { enviados.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; };
  assert.deepEqual(await ck.tarefasSenhas({ agora: new Date("2026-12-19T16:59:00Z"), buscarFn: buscar, cfg: null }), { senhas: 0 });
  assert.deepEqual(await ck.tarefasSenhas({ agora: new Date("2026-12-19T17:01:00Z"), buscarFn: buscar, cfg: null }), { senhas: 1 });
  const depois = await store.buscarCheckin({ codigo: "AG-1" });
  assert.equal(depois.senha_status, "simulada"); // fora da Vercel a simulação vale (sem fechadura)
  assert.match(depois.senha_aviso.whatsapp, /enviado/);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].text.body, new RegExp(depois.senha));
  assert.ok((await store.listarEmails()).some((m) => m.tipo === "checkin_concluido" && m.corpo.includes(depois.senha)));
  // Não entrega de novo
  assert.deepEqual(await ck.tarefasSenhas({ agora: new Date("2026-12-19T18:00:00Z"), buscarFn: buscar, cfg: null }), { senhas: 0 });
});

test("assinatura: exige PNG desenhado e gera código ligado à ficha", () => {
  assert.match(ck.registrarAssinatura(null, []).erro, /Assine/);
  assert.match(ck.registrarAssinatura("data:image/png;base64,AAAA", []).erro, /inválida/);
  const img = pngAssinatura();
  const quando = new Date("2026-12-19T12:00:00Z");
  const a = ck.registrarAssinatura(img, [titular], { ip: "1.2.3.4", agente: "x", quando });
  assert.match(a.assinatura.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.assinatura.em, quando.toISOString());
  // Outra ficha com a mesma imagem dá outro código
  assert.notEqual(ck.registrarAssinatura(img, [{ ...titular, nome: "Outra" }], { quando }).assinatura.hash, a.assinatura.hash);
});

test("MRZ: passaporte e identidade, só com dígitos verificadores conferidos", () => {
  // Exemplos do documento 9303 da ICAO
  const p = globalThis.lerMRZ("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10");
  assert.deepEqual(p, { formato: "passaporte", nascimento: "1974-08-12", nome: "Anna Maria Eriksson", genero: "MULHER", documento_tipo: "PASSAPORTE", documento_numero: "L898902C3" });
  const i = globalThis.lerMRZ("I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<");
  assert.equal(i.nascimento, "1974-08-12");
  assert.equal(i.documento_numero, undefined); // número que não é CPF não entra
  // Dígito errado na data: não aceita nada
  assert.equal(globalThis.lerMRZ("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408123F1204159ZE184226B<<<<<10"), null);
  // Brasileiro: nacionalidade BRA vira BR; número com dígito errado não entra
  const br = globalThis.lerMRZ(`P<BRASILVA<<JOAO<PEDRO<<<<<<<<<<<<<<<<<<<<<<\nFX12345670BRA9001011M3001011<<<<<<<<<<<<<<00`);
  assert.equal(br.nacionalidade, "BR");
  assert.equal(br.nome, "Joao Pedro Silva");
  assert.equal(br.nascimento, "1990-01-01");
  assert.equal(br.documento_numero, undefined);
});
