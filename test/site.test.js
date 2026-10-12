import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "si-")), "db.json");
delete process.env.SUPABASE_URL;
const { app } = await import("../src/app.js");
const { origemDoCodigo, codigoWhatsapp, CODIGO_WA_RE } = await import("../src/rastreio.js");
const store = await import("../src/store.js");

test("site: página montada no servidor, com quartos, dúvidas e dados para o Google", async () => {
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://localhost:${srv.address().port}/site`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<h1>Smart Studios e Suítes/);
    assert.match(html, /Smart Studio/);
    assert.match(html, /"@type":"Hotel"/);
    assert.match(html, /termine com #/);
    assert.ok(!/<script>alert/.test(html));
  } finally { srv.close(); }
});

test("código do WhatsApp do site liga a conversa à origem da visita", async () => {
  assert.match(codigoWhatsapp(), CODIGO_WA_RE);
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  try {
    const r = await (await fetch(`${base}/api/rastreio/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: "Oi, vim pelo site", origem: { utm_source: "instagram", utm_campaign: "bio" } }) })).json();
    assert.match(r.link, /^https:\/\/wa\.me\/5547996093817\?text=/);
    assert.ok(decodeURIComponent(r.link).includes(`(cód. ${r.codigo})`));
    const o = await origemDoCodigo(`Oi, vim pelo site (cód. ${r.codigo})`);
    assert.equal(o.utm_source, "instagram");
    assert.equal(o.utm_campaign, "bio");
    assert.equal(o.conversa_id, undefined);
    // Sem campanha: conta como visita direta ao site
    const d = await (await fetch(`${base}/api/rastreio/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    assert.equal((await origemDoCodigo(`Olá (cód. ${d.codigo})`)).utm_source, "site");
    assert.equal(await origemDoCodigo("Olá, sem código"), null);

    // Visitas por origem (sem IP)
    assert.equal((await fetch(`${base}/api/rastreio/visita`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitante: "v-12345678", pagina: "site", origem: { gclid: "abc" } }) })).status, 204);
    assert.equal((await fetch(`${base}/api/rastreio/visita`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitante: "<x>" }) })).status, 400);
    const vs = await store.listarVisitas("2000-01-01");
    assert.equal(vs.length, 1);
    assert.equal(vs[0].utm_source, "google");
    assert.equal(vs[0].ip, undefined);
  } finally { srv.close(); }
});
