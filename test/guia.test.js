import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gu-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
for (const v of ["TTLOCK_CLIENT_ID", "TTLOCK_CLIENT_SECRET", "TTLOCK_USERNAME", "TTLOCK_PASSWORD"]) delete process.env[v];
process.env.WIFI_SENHA = "senha-wifi-teste";
const guia = await import("../src/guia.js");
const ck = await import("../src/checkin.js");
const store = await import("../src/store.js");
const { carregarHotel } = await import("../src/catalogo.js");
const { app } = await import("../src/app.js");

const titular = { nome: "Ana Souza", nascimento: "1990-05-10", nacionalidade: "BR", documento_tipo: "CPF", documento_numero: "529.982.247-25", genero: "MULHER", raca: "PARDA", deficiencia: "NAO", email: "ana@exemplo.com", telefone: "(34) 99999-0000", pais_residencia: "BR", uf: "mg", cidade_id: "3170206", cidade: "Uberlândia", motivo: "LAZER_FERIAS", transporte: "AUTOMOVEL" };

test("momento da estadia e temporada", () => {
  const r = { checkin: "2027-01-10", checkout: "2027-01-13" };
  assert.deepEqual(guia.momento(r, "2027-01-07"), { fase: "antes", faltam: 3, noites: 3 });
  assert.equal(guia.momento(r, "2027-01-10").fase, "chegada");
  assert.deepEqual(guia.momento(r, "2027-01-11"), { fase: "durante", noite: 2, noites: 3 });
  assert.equal(guia.momento(r, "2027-01-13").fase, "saida");
  assert.equal(guia.momento(r, "2027-01-20").fase, "depois");
  assert.equal(guia.temporada("2027-01-10"), "alta");
  assert.equal(guia.temporada("2026-10-10"), "baixa");
});

test("guia sem pré-check-in não mostra quarto nem senha; estacionamento pela temporada", () => {
  const hotel = carregarHotel();
  const reserva = { codigo_motor: "X", quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-22", status: "confirmada", hospede: "Bruno Lima" };
  const g = guia.montarGuia({ hotel, reserva, ck: { status: "pendente", senha: "123456", senha_status: "simulada", unidade: "101" }, hoje: "2026-10-18" });
  assert.equal(g.acesso.senha, null);
  assert.equal(g.acesso.unidade, null);
  assert.equal(g.hospede.primeiro_nome, "Bruno");
  assert.equal(g.estacionamento.valor, 39);
  assert.equal(g.wifi.senha, "senha-wifi-teste");
  assert.ok(g.passeios.every((p) => p.mapa.startsWith("https://www.google.com/maps/")));
  // Reserva cancelada não mostra senha mesmo com o check-in feito
  const c = guia.montarGuia({ hotel, reserva: { ...reserva, status: "cancelada" }, ck: { status: "concluido", senha: "123456", senha_status: "simulada", unidade: "101" } });
  assert.equal(c.acesso.senha, null);
});

test("página da estadia pelo token: dados da reserva, pré-check-in e depois a senha", async () => {
  await store.salvarReserva({ codigo_motor: "P-GU01", quarto_id: "estudio", checkin: "2027-01-10", checkout: "2027-01-12", hospede: "Ana Souza", status: "confirmada" });
  await store.salvarUnidade({ numero: "305", quarto_id: "estudio" });
  const { token } = await ck.garantirCheckin("P-GU01");
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  try {
    const antes = await (await fetch(`${base}/api/checkin/${token}/estadia`)).json();
    assert.equal(antes.hospede.primeiro_nome, "Ana");
    assert.equal(antes.reserva.codigo, "P-GU01");
    assert.equal(antes.reserva.noites, 2);
    assert.equal(antes.hotel.checkout, "11:00");
    assert.equal(antes.estacionamento.valor, 59); // janeiro é alta temporada
    assert.equal(antes.acesso.senha, null);
    assert.equal(antes.link_checkin, `/checkin?c=${token}`);

    const fim = await fetch(`${base}/api/checkin/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hospedes: [titular], aceite: true }) });
    assert.equal((await fim.json()).link_guia, `/estadia?c=${token}`);
    const depois = await (await fetch(`${base}/api/checkin/${token}/estadia`)).json();
    assert.equal(depois.acesso.unidade, "305");
    assert.match(depois.acesso.senha, /^\d{6}$/);

    assert.equal((await fetch(`${base}/api/checkin/nao-existe/estadia`)).status, 404);
  } finally {
    srv.close();
  }
});

test("reserva confirmada: e-mail e WhatsApp levam o link do guia", async () => {
  const { confirmar } = await import("../src/pagamento.js");
  const enviados = [];
  const fetchOriginal = globalThis.fetch;
  Object.assign(process.env, { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" });
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes("graph.facebook.com")) return fetchOriginal(url, opts);
    enviados.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 });
  };
  try {
    const hotel = carregarHotel();
    const lead = await store.criarLead({ canal: "whatsapp", conversa_id: "wa:5547999990000", quarto_id: "suite", checkin: "2099-02-10", checkout: "2099-02-12", adultos: 2, criancas: 0 });
    const r = await confirmar(hotel, lead, { lead_id: lead.id, nome: "Carla Dias", email: "carla@exemplo.com", status: "pago" }, {}, "https://reservas.exemplo.com");
    assert.match(r.link_guia, /^https:\/\/reservas\.exemplo\.com\/estadia\?c=/);
    const email = (await store.listarEmails()).find((m) => m.tipo === "reserva_confirmada");
    assert.ok(email.corpo.includes(r.link_guia));
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].to, "5547999990000");
    assert.ok(enviados[0].text.body.includes(r.link_guia));
  } finally {
    globalThis.fetch = fetchOriginal;
    delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
});
