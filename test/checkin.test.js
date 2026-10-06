import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ck-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
for (const v of ["TTLOCK_CLIENT_ID", "TTLOCK_CLIENT_SECRET", "TTLOCK_USERNAME", "TTLOCK_PASSWORD"]) delete process.env[v];
const ck = await import("../src/checkin.js");
const { novaSenha, limparCacheToken } = await import("../src/fechaduras.js");
const store = await import("../src/store.js");
const { app } = await import("../src/app.js");

const titular = { nome: "Ana Souza", nascimento: "1990-05-10", nacionalidade: "BR", documento_tipo: "CPF", documento_numero: "529.982.247-25", genero: "MULHER", raca: "PARDA", deficiencia: "NAO", email: "ana@exemplo.com", telefone: "(34) 99999-0000", pais_residencia: "BR", uf: "mg", cidade_id: "3170206", cidade: "Uberlândia", motivo: "LAZER_FERIAS", transporte: "AUTOMOVEL" };

test("CPF e senha", () => {
  assert.ok(ck.cpfValido("529.982.247-25"));
  assert.ok(!ck.cpfValido("529.982.247-24"));
  assert.ok(!ck.cpfValido("111.111.111-11"));
  for (let i = 0; i < 200; i++) {
    const s = novaSenha();
    assert.match(s, /^\d{6}$/);
    assert.ok(!/^(\d)\1+$/.test(s) && s !== "123456");
  }
});

test("ficha: códigos da FNRH, criança com responsável, todos preenchidos e aceite", () => {
  const reserva = { checkin: "2026-12-20", adultos: 1, criancas: 1 };
  assert.match(ck.validarFicha({ hospedes: [titular], aceite: true }, reserva).erro, /2 pessoas/);
  const crianca = { nome: "Bia Souza", nascimento: "2018-01-01", nacionalidade: "BR", documento_tipo: "CPF", documento_numero: "111.444.777-35" };
  assert.match(ck.validarFicha({ hospedes: [titular, crianca] }, reserva).erro, /aceite/);
  assert.match(ck.validarFicha({ hospedes: [titular, { ...crianca, documento_numero: "" }], aceite: true }, reserva).erro, /Hóspede 2: informe o CPF/);
  assert.match(ck.validarFicha({ hospedes: [{ ...titular, cidade_id: "" }, crianca], aceite: true }, reserva).erro, /cidade/);
  const v = ck.validarFicha({ hospedes: [titular, crianca], aceite: true, chegada_prevista: "15:30" }, reserva);
  assert.equal(v.erro, undefined);
  assert.equal(v.hospedes[0].documento_numero, "52998224725");
  assert.equal(v.hospedes[0].uf, "MG");
  assert.equal(v.hospedes[0].cidade_id, 3170206);
  assert.equal(v.hospedes[1].menor, true);
  assert.equal(v.hospedes[1].raca, "NAOINFORMAR");
  // Estrangeiro: passaporte e residência fora do Brasil, sem cidade do IBGE
  const gringo = { ...titular, nacionalidade: "ar", documento_tipo: "PASSAPORTE", documento_numero: "aab-123456", pais_residencia: "AR", uf: "", cidade_id: "", cidade: "Rosario" };
  const g = ck.validarFicha({ hospedes: [gringo], aceite: true }, { checkin: "2026-12-20", adultos: 1, criancas: 0 });
  assert.equal(g.hospedes[0].nacionalidade, "AR");
  assert.equal(g.hospedes[0].documento_numero, "AAB123456");
  assert.match(ck.validarFicha({ hospedes: [{ ...titular, nascimento: "2010-01-01" }, crianca], aceite: true }, reserva).erro, /maior de idade/);
  assert.match(ck.validarFicha({ hospedes: [{ ...titular, documento_numero: "123" }, crianca], aceite: true }, reserva).erro, /CPF inválido/);
});

test("FNRH: monta o registro e envia ficha, entrada e cancelamento", async () => {
  const { montarRegistro, registrarFicha, eventoFNRH } = await import("../src/fnrh.js");
  const reserva = { codigo_motor: "P-FN01", quarto_id: "suite", checkin: "2026-12-20", checkout: "2026-12-22", hospede: "Ana Souza", status: "confirmada" };
  const crianca = { nome: "Bia Souza", nascimento: "2018-01-01", nacionalidade: "BR", documento_tipo: "CPF", documento_numero: "11144477735" };
  const { hospedes } = ck.validarFicha({ hospedes: [titular, crianca], aceite: true }, { ...reserva, adultos: 1, criancas: 1 });
  const corpo = montarRegistro(reserva, hospedes);
  assert.deepEqual(corpo.reserva, { numero_reserva: "P-FN01", numero_reserva_ota: "", data_entrada: "2026-12-20", data_saida: "2026-12-22", quantidade_hospede_adulto: 1, quantidade_hospede_menor: 1, origem_reserva_id: "MEIOHOSPEDAGEM" });
  const [t, c] = corpo.dados_hospede;
  assert.equal(t.is_principal, true);
  assert.equal(t.dados_pessoais.nome, "ANA SOUZA");
  assert.deepEqual(t.dados_pessoais.documento_id, { numero_documento: "52998224725", tipo_documento_id: "CPF" });
  assert.equal(t.dados_pessoais.contato.cidade_id, 3170206);
  assert.equal(t.dados_ficha.motivo_viagem_id, "LAZER_FERIAS");
  assert.deepEqual(c.responsavel, { numero_documento: "52998224725", tipo_documento_id: "CPF" });

  await store.salvarReserva(reserva);
  await store.salvarCheckin({ codigo_reserva: "P-FN01", token: "fn", status: "concluido", hospedes });
  // Sem credenciais: só marca como simulado
  assert.equal((await registrarFicha("P-FN01", { cfg: null })).fnrh_status, "simulado");

  const chamadas = [];
  const fake = async (url, op) => {
    chamadas.push({ url, op });
    if (url.endsWith("/hospedagem/registrar")) return { ok: true, status: 200, text: async () => JSON.stringify({ dados: { reserva: { reserva_id: "uuid-1", link_precheckin: "https://gov/x" } } }) };
    return { ok: true, status: 200, text: async () => "" };
  };
  const cfg = { url: "https://homlowcode.serpro.gov.br/FNRH_API/rest/v2", cpf: "52998224725", auth: "Basic abc", situacao: "PRECHECKIN_REALIZADO" };
  const r = await registrarFicha("P-FN01", { cfg, buscarFn: fake });
  assert.equal(r.fnrh_status, "registrado");
  assert.equal(r.fnrh_reserva_id, "uuid-1");
  assert.equal(chamadas[0].op.headers.cpf_solicitante, "52998224725");
  assert.equal(chamadas[0].op.headers.Authorization, "Basic abc");

  const e = await eventoFNRH("P-FN01", "entrada", { cfg, buscarFn: fake, quando: new Date("2026-12-20T17:00:00Z") });
  assert.equal(e.fnrh_entrada_em, "2026-12-20T17:00:00.000Z");
  const ent = chamadas.at(-1);
  assert.match(ent.url, /\/reservas\/uuid-1\/checkin$/);
  assert.equal(ent.op.body, "2026-12-20T17:00:00.000Z");
  assert.equal(ent.op.headers["Content-Type"], "text/plain");
  // Depois da entrada, cancelar não chama a FNRH (só reservas CRIADA podem ser canceladas)
  const n = chamadas.length;
  await eventoFNRH("P-FN01", "cancelar", { cfg, buscarFn: fake });
  assert.equal(chamadas.length, n);

  const erro = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ mensagem: "cidade_id inválido" }) });
  await store.salvarCheckin({ codigo_reserva: "P-FN01", fnrh_reserva_id: null });
  assert.match((await registrarFicha("P-FN01", { cfg, buscarFn: erro })).fnrh_erro, /400: cidade_id inválido/);
});

test("janela da senha e escolha da unidade sem sobreposição", () => {
  const j = ck.janelaSenha({ checkin: "14:00", checkout: "12:00" }, { checkin: "2026-12-20", checkout: "2026-12-22" });
  assert.equal(j.inicio.toISOString(), "2026-12-20T17:00:00.000Z");
  assert.equal(j.fim.toISOString(), "2026-12-22T15:00:00.000Z");
  const unidades = [{ numero: "101", quarto_id: "suite" }, { numero: "102", quarto_id: "suite" }, { numero: "201", quarto_id: "estudio" }];
  const reservas = [
    { codigo_motor: "A", status: "confirmada", checkin: "2026-12-19", checkout: "2026-12-21" },
    { codigo_motor: "B", status: "cancelada", checkin: "2026-12-20", checkout: "2026-12-22" },
  ];
  const checkins = [{ codigo_reserva: "A", unidade: "101" }, { codigo_reserva: "B", unidade: "102" }];
  const nova = { codigo_motor: "C", quarto_id: "suite", checkin: "2026-12-20", checkout: "2026-12-22" };
  assert.equal(ck.escolherUnidade({ reserva: nova, unidades, checkins, reservas }).numero, "102"); // B foi cancelada
  assert.equal(ck.escolherUnidade({ reserva: { ...nova, checkin: "2026-12-21" }, unidades, checkins, reservas }).numero, "101"); // A sai dia 21
});

test("senha na TTLock: cria com a janela certa e apaga ao revogar", async () => {
  limparCacheToken();
  await store.salvarReserva({ codigo_motor: "P-TT01", quarto_id: "suite", checkin: "2026-12-20", checkout: "2026-12-22", hospede: "Ana Souza", status: "confirmada" });
  await store.salvarUnidade({ numero: "301", quarto_id: "suite", lock_id: "778899" });
  const chamadas = [];
  const fakeFetch = async (url, op) => {
    const campos = Object.fromEntries(new URLSearchParams(op.body));
    chamadas.push({ url, campos });
    if (url.endsWith("/oauth2/token")) return { ok: true, json: async () => ({ access_token: "tk", expires_in: 7776000 }) };
    if (url.endsWith("/v3/keyboardPwd/add")) return { ok: true, json: async () => ({ keyboardPwdId: 555 }) };
    return { ok: true, json: async () => ({ errcode: 0 }) };
  };
  const cfg = { url: "https://euapi.ttlock.com", clientId: "id", segredo: "s", usuario: "u", senha: "minhasenha" };
  const r = await ck.emitirSenha("P-TT01", { buscarFn: fakeFetch, cfg });
  assert.equal(r.senha_status, "ativa");
  assert.equal(r.unidade, "301");
  assert.equal(r.senha_id, "555");
  const add = chamadas.find((c) => c.url.endsWith("/add")).campos;
  assert.equal(add.lockId, "778899");
  assert.equal(add.keyboardPwd, r.senha);
  assert.equal(add.startDate, String(Date.parse("2026-12-20T17:00:00Z")));
  assert.equal(add.addType, "2");
  assert.match(chamadas[0].campos.password, /^[a-f0-9]{32}$/); // a TTLock recebe a senha em MD5

  const rv = await ck.revogarSenha("P-TT01", { buscarFn: fakeFetch, cfg });
  assert.equal(rv.senha_status, "revogada");
  assert.equal(rv.senha, null);
  const del = chamadas.find((c) => c.url.endsWith("/delete")).campos;
  assert.equal(del.keyboardPwdId, "555");

  // Erro da TTLock fica registrado e não mostra senha
  const falha = async (url) => url.endsWith("/add") ? { ok: true, json: async () => ({ errcode: -3003, errmsg: "gateway offline" }) } : fakeFetch(url, { body: "" });
  const e = await ck.emitirSenha("P-TT01", { buscarFn: falha, cfg });
  assert.equal(e.senha_status, "erro");
  assert.equal(e.senha, null);
  assert.match(e.senha_erro, /gateway offline/);
});

test("fluxo do hóspede: link, ficha, senha simulada e e-mail", async () => {
  await store.salvarReserva({ codigo_motor: "P-FL01", quarto_id: "estudio", checkin: "2027-01-10", checkout: "2027-01-12", hospede: "Ana Souza", status: "confirmada" });
  await store.salvarUnidade({ numero: "201", quarto_id: "estudio" });
  const { token } = await ck.garantirCheckin("P-FL01");
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/api/checkin/${token}`;
  try {
    const g = await (await fetch(base)).json();
    assert.equal(g.reserva.codigo, "P-FL01");
    assert.equal(g.concluido, false);
    const ruim = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hospedes: [{ nome: "Ana" }], aceite: true }) });
    assert.equal(ruim.status, 400);
    const ok = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hospedes: [titular], aceite: true }) });
    assert.equal(ok.status, 200);
    const depois = await (await fetch(base)).json();
    assert.equal(depois.concluido, true);
    assert.equal(depois.acesso.unidade, "201");
    assert.match(depois.acesso.senha, /^\d{6}$/);
    assert.equal(depois.acesso.simulada, true);
    assert.equal((await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 409);
    const email = (await store.listarEmails()).find((m) => m.tipo === "checkin_concluido");
    assert.match(email.corpo, new RegExp(depois.acesso.senha));
    assert.equal((await fetch(base.replace(token, "nao-existe"))).status, 404);
  } finally {
    srv.close();
  }
});
