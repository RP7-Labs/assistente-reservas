import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lm-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_API_KEY;
for (const v of ["META_DATASET_ID", "META_CAPI_TOKEN"]) delete process.env[v];
Object.assign(process.env, {
  WHATSAPP_TOKEN: "wa-tok", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_MODELO_LEAD: "lead_boas_vindas",
  META_PAGE_TOKEN: "page-tok", META_APP_SECRET: "segredo-app",
});
const lm = await import("../src/leadsMeta.js");
const store = await import("../src/store.js");
const { responderPorRegras } = await import("../src/regras.js");
const { carregarHotel, precoTotal } = await import("../src/catalogo.js");
const { eventoMeta } = await import("../src/rastreio.js");
const { app } = await import("../src/app.js");

// Intercepta a Graph API (lead e WhatsApp); o resto passa direto
const enviados = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.includes("graph.facebook.com")) return fetchOriginal(url, opts);
  const json = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("/messages")) {
    const corpo = JSON.parse(opts.body);
    enviados.push(corpo);
    // Número antigo: o WhatsApp devolve o wa_id sem o nono dígito
    return json({ contacts: [{ input: corpo.to, wa_id: corpo.to.replace(/^55(\d\d)9/, "55$1") }], messages: [{ id: "wamid.1" }] });
  }
  if (u.includes("/998877")) {
    return json({ id: "998877", created_time: "2026-10-10T20:00:00+0000", ad_id: "ad1", ad_name: "Video studio", campaign_name: "[TRACK]-[LEADS] Studio", form_id: "f1", platform: "ig",
      field_data: [{ name: "full_name", values: ["Bruno Lima"] }, { name: "phone_number", values: ["+55 47 98888-1111"] }, { name: "email", values: ["bruno@exemplo.com"] },
        { name: "por_quanto_tempo?", values: ["1 mês"] }, { name: "motivo", values: ["trabalho"] }] });
  }
  return json({ error: { message: "não encontrado" } }, 404);
};

test("telefone, campos do formulário e assinatura", () => {
  assert.equal(lm.telefoneWhatsapp("(47) 99999-0000"), "5547999990000");
  assert.equal(lm.telefoneWhatsapp("+55 47 99999-0000"), "5547999990000");
  assert.equal(lm.telefoneWhatsapp("123"), null);
  const c = lm.lerCampos([{ name: "first_name", values: ["Ana"] }, { name: "last_name", values: ["Souza"] }, { name: "phone_number", values: ["47999990000"] }, { name: "quando_pretende_vir?", values: ["novembro"] }]);
  assert.equal(c.nome, "Ana Souza");
  assert.deepEqual(c.respostas, [{ pergunta: "quando pretende vir", resposta: "novembro" }]);
  const corpo = Buffer.from('{"a":1}');
  const sig = "sha256=" + crypto.createHmac("sha256", "s").update(corpo).digest("hex");
  assert.ok(lm.assinaturaValida(corpo, sig, "s"));
  assert.ok(!lm.assinaturaValida(corpo, sig, "outro"));
  assert.deepEqual(lm.idsDoWebhook({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: 5 } }, { field: "feed", value: {} }] }] }), ["5"]);
});

test("estadia mensal: preço do mês e conversa por regras", () => {
  const hotel = carregarHotel();
  const estudio = hotel.quartos.find((q) => q.id === "estudio");
  assert.equal(precoTotal(estudio, 2), estudio.preco_a_partir * 2);
  assert.equal(precoTotal(estudio, 30), estudio.preco_mensal);
  const r = responderPorRegras(hotel, ["(Respostas do formulário do anúncio) por quanto tempo: 1 mês. motivo: trabalho", "estúdio a partir de 01/11 para 1 adulto"], "2026-10-10");
  assert.equal(r.acao?.tipo, "link");
  assert.equal(r.acao.pedido.checkout, "2026-12-01");
  assert.match(r.texto, /mensal/);
});

test("evento de CRM para lead de formulário", () => {
  const e = eventoMeta({ evento: "Purchase", eventId: "P-1", origem: { meta_lead_id: "998877" }, pessoa: { email: "a@b.com" }, valor: 3200 });
  assert.equal(e.action_source, "system_generated");
  assert.equal(e.user_data.lead_id, "998877");
  assert.equal(e.custom_data.event_source, "crm");
});

test("webhook: lead assinado vira mensagem no WhatsApp, conversa preparada e origem; repetição não reenvia", async () => {
  const srv = app.listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/webhook/meta-leads`;
  const corpo = JSON.stringify({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "998877", form_id: "f1" } }] }] });
  const sig = "sha256=" + crypto.createHmac("sha256", "segredo-app").update(corpo).digest("hex");
  const post = (h) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: corpo });
  try {
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ "X-Hub-Signature-256": sig })).status, 200);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].to, "5547988881111");
    assert.equal(enviados[0].template.name, "lead_boas_vindas");
    assert.equal(enviados[0].template.components[0].parameters[0].text, "Bruno");

    const lead = await store.buscarLeadMeta("998877");
    assert.equal(lead.status, "contatado");
    assert.equal(lead.conversa_id, "wa:554788881111");
    const conversa = await store.carregarConversa(lead.conversa_id);
    assert.match(conversa[0].content, /1 mês/);
    const origem = await store.buscarOrigem(lead.conversa_id);
    assert.equal(origem.meta_lead_id, "998877");
    assert.equal(origem.utm_medium, "lead_ads");

    await post({ "X-Hub-Signature-256": sig });
    assert.equal(enviados.length, 1);

    // A resposta da pessoa marca o lead e segue o fluxo com o que o formulário já disse
    const wa = await fetch(url.replace("meta-leads", "whatsapp"), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "554788881111", type: "text", text: { body: "estúdio a partir de 01/11, 1 adulto" } }] } }] }] }) });
    assert.equal(wa.status, 200);
    assert.ok((await store.buscarLeadMeta("998877")).respondeu_em);
    const resposta = enviados.at(-1);
    assert.match(resposta.text?.body ?? resposta.interactive?.body?.text, /30 noites/);
  } finally {
    srv.close();
  }
});

test("lead sem modelo configurado fica esperando, e o admin consegue chamar depois", async () => {
  delete process.env.WHATSAPP_MODELO_LEAD;
  const l = await lm.receberLead({ id: "x1", nome: "Carla", telefone: "47977776666", respostas: [] });
  assert.equal(l.status, "sem_modelo");
  process.env.WHATSAPP_MODELO_LEAD = "lead_boas_vindas";
  const r = await lm.contatarLead(await store.buscarLeadMeta("x1"));
  assert.equal(r.status, "contatado");
  const corp = await lm.receberLead({ id: "x2", nome: "Empresa X", telefone: "47966665555", respostas: [{ pergunta: "motivo", resposta: "hospedagem corporativa para equipe" }] });
  assert.equal(corp.status, "contatado");
});
