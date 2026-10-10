import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ras-")), "db.json");
delete process.env.SUPABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_API_KEY;
const r = await import("../src/rastreio.js");
const store = await import("../src/store.js");
const { app } = await import("../src/app.js");

const req = { get: (h) => ({ "x-forwarded-for": "200.1.2.3, 10.0.0.1", "user-agent": "Mozilla/5.0" })[h] };

test("origem: fonte deduzida pelo clique e fbc no formato da Meta", () => {
  const g = r.normalizarOrigem({ gclid: "Cj0abc" }, req);
  assert.equal(g.utm_source, "google");
  assert.equal(g.ip, "200.1.2.3");
  const m = r.normalizarOrigem({ fbclid: "IwAR1", fbclid_em: 1760000000000 });
  assert.equal(m.utm_source, "meta");
  assert.equal(m.fbc, "fb.1.1760000000000.IwAR1");
  assert.equal(r.fonte({ referrer: "https://www.google.com/search?q=hotel" }), "google.com");
  assert.equal(r.fonte(null), "direto");
});

test("origem: último clique de campanha vale; visita sem campanha não apaga", async () => {
  await r.registrarOrigem("c1", "web", r.normalizarOrigem({ utm_source: "google", utm_campaign: "natal", gclid: "G1" }));
  await r.registrarOrigem("c1", "web", r.normalizarOrigem({ fbp: "fb.1.1.2" }));
  let o = await store.buscarOrigem("c1");
  assert.equal(o.utm_campaign, "natal");
  assert.equal(o.fbp, "fb.1.1.2");
  await r.registrarOrigem("c1", "web", r.normalizarOrigem({ utm_source: "meta", utm_campaign: "carnaval", fbclid: "F1" }));
  o = await store.buscarOrigem("c1");
  assert.equal(o.utm_campaign, "carnaval");
  assert.equal(await r.registrarOrigem("c2", "web", r.normalizarOrigem({})), null);
});

test("WhatsApp: anúncio de clique vira origem com ctwa_clid", () => {
  const o = r.origemWhatsapp({ referral: { source_type: "ad", source_id: "12345", headline: "Natal na serra", ctwa_clid: "ARAx" } });
  assert.equal(o.utm_source, "meta");
  assert.equal(o.utm_medium, "whatsapp_ads");
  assert.equal(o.ad_id, "12345");
  assert.equal(o.ctwa_clid, "ARAx");
  assert.equal(r.origemWhatsapp({ text: { body: "oi" } }), null);
});

test("Meta: evento do site com dados em hash e evento de WhatsApp com ctwa_clid", () => {
  const h = (v) => crypto.createHash("sha256").update(v).digest("hex");
  const w = r.eventoMeta({ evento: "Purchase", eventId: "P-1", valor: 660, url: "https://x/pagamento", quando: new Date(1760000000000),
    origem: { fbc: "fb.1.1.IwAR1", fbp: "fb.1.2.3", ip: "200.1.2.3", user_agent: "UA" }, pessoa: { email: " Ana@Exemplo.com ", telefone: "(34) 99999-0000", nome: "Ana Souza" } });
  assert.equal(w.action_source, "website");
  assert.equal(w.event_time, 1760000000);
  assert.deepEqual(w.user_data.em, [h("ana@exemplo.com")]);
  assert.deepEqual(w.user_data.ph, [h("5534999990000")]);
  assert.deepEqual(w.user_data.ln, [h("souza")]);
  assert.equal(w.user_data.fbc, "fb.1.1.IwAR1");
  assert.deepEqual(w.custom_data, { currency: "BRL", value: 660 });
  const z = r.eventoMeta({ evento: "Purchase", eventId: "P-2", valor: 100, origem: { ctwa_clid: "ARAx" }, waba: "999" });
  assert.equal(z.action_source, "business_messaging");
  assert.equal(z.messaging_channel, "whatsapp");
  assert.deepEqual(z.user_data, { whatsapp_business_account_id: "999", ctwa_clid: "ARAx" });
});

test("Meta: envia uma vez por event_id e registra falhas", async () => {
  const lead = await store.criarLead({ canal: "web", conversa_id: "c1", quarto_id: "suite", checkin: "2026-12-20", checkout: "2026-12-22", adultos: 2, criancas: 0, noites: 2 });
  const chamadas = [];
  const ok = async (url, op) => { chamadas.push({ url, corpo: JSON.parse(op.body) }); return { ok: true, text: async () => '{"events_received":1}' }; };
  const cfg = { dataset: "123", token: "tok", versao: "v21.0", teste: "TEST1", waba: null };
  assert.equal((await r.enviarMeta({ evento: "Purchase", eventId: "P-9", leadId: lead.id, valor: 560, pessoa: { email: "a@b.com" } }, { cfg, buscarFn: ok })).enviado, true);
  assert.match(chamadas[0].url, /graph\.facebook\.com\/v21\.0\/123\/events\?access_token=tok/);
  assert.equal(chamadas[0].corpo.test_event_code, "TEST1");
  assert.equal(chamadas[0].corpo.data[0].user_data.fbc.endsWith(".F1"), true); // origem da conversa do lead
  assert.equal((await r.enviarMeta({ evento: "Purchase", eventId: "P-9", leadId: lead.id, valor: 560 }, { cfg, buscarFn: ok })).motivo, "já enviado");
  assert.equal(chamadas.length, 1);
  const falha = async () => ({ ok: false, text: async () => '{"error":{"message":"Invalid token"}}' });
  await r.enviarMeta({ evento: "Purchase", eventId: "P-10", valor: 1 }, { cfg, buscarFn: falha });
  const reg = (await store.listarConversoes()).find((c) => c.event_id === "P-10");
  assert.equal(reg.ok, false);
  assert.match(reg.resposta, /Invalid token/);
  assert.equal((await r.enviarMeta({ evento: "Purchase", eventId: "P-11" }, { cfg: null })).enviado, false);
});

test("CSV de conversões offline do Google Ads", () => {
  const csv = r.csvGoogleAds([{ gclid: "Cj0abc", valor: 660, quando: "2026-12-01T15:30:00Z" }, { gclid: null, valor: 1, quando: "2026-12-01T15:30:00Z" }]);
  assert.equal(csv, "Parameters:TimeZone=-0300\nGoogle Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency\nCj0abc,Reserva paga,2026-12-01 12:30:00,660.00,BRL\n");
});

test("chat guarda a origem enviada na primeira mensagem", async () => {
  const srv = app.listen(0);
  try {
    const url = `http://localhost:${srv.address().port}/api/chat`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Teste" },
      body: JSON.stringify({ conversaId: "web-1", texto: "oi", origem: { utm_source: "google", utm_campaign: "reveillon", gclid: "Gx" } }) });
    assert.equal(res.status, 200);
    const o = await store.buscarOrigem("web-1");
    assert.equal(o.utm_campaign, "reveillon");
    assert.equal(o.canal, "web");
    const cfg = await (await fetch(url.replace("/chat", "/rastreio/config"))).json();
    assert.deepEqual(Object.keys(cfg).sort(), ["google_ads", "google_compra", "google_lead", "meta_pixel"]);
  } finally {
    srv.close();
  }
});
