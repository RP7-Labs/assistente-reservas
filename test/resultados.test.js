import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "res-")), "db.json");
process.env.SESSION_SECRET = "segredo-de-teste-123456";
delete process.env.SUPABASE_URL;
const imp = await import("../src/importacao.js");
const R = await import("../src/resultados.js");
const store = await import("../src/store.js");
const { criarToken } = await import("../src/auth.js");
const { app } = await import("../src/app.js");

const config = R.configCompleta({});
const sistema = (codigo, extra = {}) => ({ codigo_motor: codigo, lead_id: `l-${codigo}`, quarto_id: "suite", checkin: "2026-10-20", checkout: "2026-10-22", valor: 500, status: "confirmada", criado_em: "2026-10-05T12:00:00Z", ...extra });
const lead = (codigo) => ({ id: `l-${codigo}`, conversa_id: `c-${codigo}` });

test("CSV: separador, aspas, BOM, números e datas em formatos BR e US", () => {
  assert.deepEqual(imp.lerCsv('﻿a;b\n"x;y";2'), [["a", "b"], ["x;y", "2"]]);
  assert.equal(imp.numero("R$ 1.234,56"), 1234.56);
  assert.equal(imp.numero("1,234.56"), 1234.56);
  assert.equal(imp.numero("1.500"), 1500);
  assert.equal(imp.numero("12,5%"), 12.5);
  assert.equal(imp.dataIso("05/10/2026"), "2026-10-05");
  assert.equal(imp.dataIso("2026-10-05"), "2026-10-05");
  assert.equal(imp.dataIso("Oct 5, 2026"), "2026-10-05");
  assert.equal(imp.dataIso("5 de out. de 2026"), "2026-10-05");
});

test("importa Google Ads (com linhas de título e total) e Meta Ads", () => {
  const g = imp.importarGoogleAds("Relatório de campanha\n1 de out. de 2026 - 2 de out. de 2026\nDia,Campanha,ID da campanha,Custo,Impr.,Cliques,Conversões\n2026-10-01,Pesquisa,111,\"10,50\",100,7,1\n2026-10-02,Pesquisa,111,\"20,00\",200,9,0\nTotal: conta,,,\"30,50\",300,16,1");
  assert.equal(g.linhas.length, 2);
  assert.equal(g.ignoradas, 1);
  assert.equal(g.linhas[0].custo, 10.5);
  assert.equal(g.linhas[0].campanha_id, "111");
  assert.deepEqual(g.periodo, { de: "2026-10-01", ate: "2026-10-02" });
  const m = imp.importarMetaAds("Início dos relatórios;Nome da campanha;Identificação da campanha;Valor usado (BRL);Impressões;Cliques no link;Resultados\n2026-10-01;Leads;222;15,00;1000;12;3");
  assert.equal(m.linhas[0].plataforma, "meta");
  assert.equal(m.linhas[0].custo, 15);
  assert.equal(m.linhas[0].conversoes_plataforma, 3);
  assert.ok(imp.importarGoogleAds("x,y\n1,2").erro);
});

test("importa relatório do PMS e traduz status", () => {
  const p = imp.importarPms("Reserva;Data da reserva;Entrada;Saída;Valor total;Canal;Situação\nA1;01/10/2026;10/10/2026;12/10/2026;400,00;Booking.com;Confirmada\nA2;02/10/2026;11/10/2026;13/10/2026;300,00;Balcão;Cancelada\n;02/10/2026;11/10/2026;;;;");
  assert.equal(p.linhas.length, 2);
  assert.equal(p.erros.length, 1);
  assert.equal(p.linhas[0].noites, 2);
  assert.equal(p.linhas[1].status, "cancelada");
  assert.equal(imp.statusReserva("No-show"), "no_show");
  assert.equal(R.canalDoPms("Booking.com"), "ota");
  assert.equal(R.canalDoPms("Balcão"), "direto");
});

test("ROAS e custo por reserva; cancelada não é receita; Google e Meta não são somados", () => {
  const reservas = [sistema("G1"), sistema("G2", { valor: 300 }), sistema("G3", { status: "cancelada" }), sistema("M1", { valor: 1000 })];
  const leads = reservas.map((r) => lead(r.codigo_motor));
  const origens = [
    { conversa_id: "c-G1", utm_source: "google", utm_medium: "cpc", utm_campaign: "111" },
    { conversa_id: "c-G2", utm_source: "google", utm_medium: "cpc", utm_campaign: "111" },
    { conversa_id: "c-G3", utm_source: "google", utm_medium: "cpc", utm_campaign: "111" },
    { conversa_id: "c-M1", utm_source: "meta", utm_medium: "paid_social", utm_campaign: "222" },
  ];
  // As duas plataformas dizem que converteram (inclusive a mesma reserva): o painel não soma isso
  const midia = [
    { plataforma: "google", data: "2026-10-05", campanha_id: "111", campanha: "Pesquisa", custo: 200, cliques: 50, impressoes: 900, conversoes_plataforma: 4 },
    { plataforma: "meta", data: "2026-10-05", campanha_id: "222", campanha: "Leads", custo: 100, cliques: 80, impressoes: 9000, conversoes_plataforma: 5 },
  ];
  const { reservas: lista } = R.unificarReservas({ reservas, leads, origens, externas: [] });
  const r = R.resumir({ de: "2026-10-01", ate: "2026-10-31", reservas: lista, midia, origens, config });
  const g = r.canais.find((c) => c.canal === "google_ads");
  assert.equal(g.reservas, 2);
  assert.equal(g.canceladas, 1);
  assert.equal(g.receita_bruta, 800);
  assert.equal(g.roas, 4);
  assert.equal(g.custo_por_reserva, 100);
  assert.equal(r.kpis.reservas, 3);
  assert.equal(r.kpis.receita_bruta, 1800);
  assert.equal(r.kpis.investimento, 300);
  assert.equal(r.kpis.conv_google, 4);
  assert.equal(r.kpis.conv_meta, 5);
  assert.equal(r.kpis.reservas_campanhas, 3); // reservas reais, não 4 + 5 conversões das plataformas
  assert.equal(R.valoresReserva({ status: "cancelada", valor: 999 }, config.financeiro).bruta, 0);
});

test("sem origem a reserva fica 'origem desconhecida' e canais sem gasto não têm custo por reserva", () => {
  const reservas = [sistema("X1"), sistema("X2", { lead_id: null })];
  const { reservas: lista } = R.unificarReservas({ reservas, leads: [lead("X1")], origens: [], externas: [] });
  const r = R.resumir({ de: "2026-10-01", ate: "2026-10-31", reservas: lista, config });
  assert.equal(r.canais.find((c) => c.canal === "desconhecido").reservas, 1);
  assert.equal(r.canais.find((c) => c.canal === "direto").reservas, 1);
  assert.equal(r.canais.find((c) => c.canal === "direto").custo_por_reserva, null);
  assert.equal(r.campanhas.length, 0);
});

test("conciliação com o PMS: pelo código, por datas e valor, sem contar duas vezes", () => {
  const reservas = [sistema("S1"), sistema("S2", { checkin: "2026-11-01", checkout: "2026-11-03", valor: 640 }), sistema("S3", { checkin: "2026-12-01", checkout: "2026-12-02" })];
  const externas = [
    { codigo: "S1", data_reserva: "2026-10-05", checkin: "2026-10-20", checkout: "2026-10-22", valor_bruto: 520, canal: "Site", status: "confirmada" },
    { codigo: "PMS-99", data_reserva: "2026-10-05", checkin: "2026-11-01", checkout: "2026-11-03", valor_bruto: 640, canal: "Site", status: "confirmada" },
    { codigo: "BK-1", data_reserva: "2026-10-06", checkin: "2026-10-10", checkout: "2026-10-11", valor_bruto: 200, canal: "Booking.com", status: "confirmada" },
  ];
  const { reservas: lista, conciliacao } = R.unificarReservas({ reservas, leads: reservas.map((r) => lead(r.codigo_motor)), origens: [], externas });
  assert.deepEqual(conciliacao, { por_codigo: 1, por_datas_valor: 1, so_pms: 1, so_sistema: 1 });
  assert.equal(lista.length, 4);
  assert.equal(lista.find((r) => r.codigo === "S1").valor, 520); // o PMS manda no valor
  assert.equal(lista.find((r) => r.codigo === "BK-1").canal, "ota");
});

test("alertas exigem amostra mínima e trazem ação e critério", () => {
  const midia = Array.from({ length: 20 }, (_, i) => ({ plataforma: "meta", data: `2026-10-${String(i + 1).padStart(2, "0")}`, campanha_id: "9", campanha: "Tráfego", custo: 30, cliques: 40, impressoes: 3000, conversoes_plataforma: 0 }));
  const resumo = R.resumir({ de: "2026-10-01", ate: "2026-10-20", reservas: [], midia, config });
  const anterior = R.resumir({ de: "2026-09-11", ate: "2026-09-30", reservas: [], midia, config });
  const q = R.qualidade({ resumo, conciliacao: { por_codigo: 0, por_datas_valor: 0, so_pms: 0, so_sistema: 0 }, importacoes: [], midia, hoje: "2026-10-21" });
  const als = R.alertas({ resumo, anterior, qualidade: q, config });
  const semReserva = als.find((a) => a.tipo === "sem_reserva");
  assert.ok(semReserva, "gastou R$ 600 em 20 dias sem reserva");
  for (const a of als) assert.ok(a.acao && a.criterio && a.prioridade && a.confianca);
  const pouco = R.resumir({ de: "2026-10-01", ate: "2026-10-02", reservas: [], midia: midia.slice(0, 2), config });
  assert.ok(!R.alertas({ resumo: pouco, anterior, qualidade: q, config }).some((a) => a.tipo === "sem_reserva"));
});

test("recomendação de aumentar verba é bloqueada com ocupação alta", () => {
  const reservas = Array.from({ length: 8 }, (_, i) => sistema(`R${i}`, { valor: 2000 }));
  const origens = reservas.map((r) => ({ conversa_id: `c-${r.codigo_motor}`, utm_source: "google", utm_medium: "cpc", utm_campaign: "111" }));
  const { reservas: lista } = R.unificarReservas({ reservas, leads: reservas.map((r) => lead(r.codigo_motor)), origens, externas: [] });
  const midia = Array.from({ length: 20 }, (_, i) => ({ plataforma: "google", data: `2026-10-${String(i + 1).padStart(2, "0")}`, campanha_id: "111", campanha: "Pesquisa", custo: 10, cliques: 10, impressoes: 100 }));
  const resumo = R.resumir({ de: "2026-10-01", ate: "2026-10-31", reservas: lista, midia, origens, config });
  const aumentar = (ocup) => R.recomendacoes({ resumo, alertas: [], config, ocupacao: { pct: ocup } }).some((r) => /Aumentar/.test(r.titulo));
  assert.ok(aumentar(50));
  assert.ok(!aumentar(95));
});

test("sazonalidade usa as metas configuradas da baixa temporada", () => {
  const saz = R.sazonalidade({ reservas: [], config, ano: 2026 });
  assert.equal(saz.length, 12);
  assert.equal(saz[0].temporada, "alta");
  assert.equal(saz[5].temporada, "baixa");
  assert.equal(saz[5].meta_receita_min, 60000);
});

// ---- Rotas ----
const servidor = http.createServer(app);
await new Promise((ok) => servidor.listen(0, ok));
const base = `http://127.0.0.1:${servidor.address().port}/api/admin/resultados`;
const adm = await store.criarAdmin({ nome: "Teste", email: "teste@exemplo.com", senha_hash: "x", status: "aprovado" });
const cab = { "Content-Type": "application/json", Authorization: `Bearer ${criarToken(adm.id)}` };

test("rotas exigem login", async () => {
  assert.equal((await fetch(base + "/")).status, 401);
  assert.equal((await fetch(base + "/importar", { method: "POST" })).status, 401);
  assert.equal((await fetch(base + "/config/metas", { method: "PUT" })).status, 401);
});

test("importação: prévia não grava; confirmar grava; repetir não duplica; fica na auditoria", async () => {
  const conteudo = "Dia,Campanha,ID da campanha,Custo,Impr.,Cliques,Conversões\n2026-10-01,Pesquisa,111,10.5,100,7,1\n2026-10-02,Pesquisa,111,20,200,9,0";
  const post = (b) => fetch(base + "/importar", { method: "POST", headers: cab, body: JSON.stringify(b) }).then((r) => r.json());
  const p = await post({ tipo: "google", arquivo: "g.csv", conteudo });
  assert.equal(p.previa.linhas, 2);
  assert.equal(p.importado, undefined);
  assert.equal((await store.listarMidia("2026-10-01", "2026-10-31")).length, 0);
  const a = await post({ tipo: "google", arquivo: "g.csv", conteudo, confirmar: true });
  assert.equal(a.importado.novas, 2);
  const b = await post({ tipo: "google", arquivo: "g.csv", conteudo: conteudo.replace("10.5", "11"), confirmar: true });
  assert.equal(b.importado.novas, 0);
  assert.equal(b.importado.atualizadas, 2);
  const midia = await store.listarMidia("2026-10-01", "2026-10-31");
  assert.equal(midia.length, 2);
  assert.equal(midia.find((m) => m.data === "2026-10-01").custo, 11);
  const aud = await fetch(base + "/auditoria", { headers: cab }).then((r) => r.json());
  assert.ok(aud.some((x) => /importou relatório google/.test(x.acao) && x.usuario === "teste@exemplo.com"));
  assert.equal((await fetch(base + "/importar", { method: "POST", headers: cab, body: JSON.stringify({ tipo: "x", conteudo }) })).status, 400);
});

test("configuração valida limites e registra quem mudou", async () => {
  const put = (chave, b) => fetch(`${base}/config/${chave}`, { method: "PUT", headers: cab, body: JSON.stringify(b) });
  assert.equal((await put("financeiro", { comissao_ota_pct: 80 })).status, 400);
  assert.equal((await put("metas", { meses_alta: [13] })).status, 400);
  assert.equal((await put("nada", {})).status, 400);
  const ok = await put("financeiro", { comissao_ota_pct: 18 });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).comissao_ota_pct, 18);
  const aud = await fetch(base + "/auditoria", { headers: cab }).then((r) => r.json());
  assert.ok(aud.some((x) => x.acao === "alterou financeiro"));
});

test("painel: só dados reais (sem demonstração) e CSV", async () => {
  const real = await fetch(base + "/?de=2026-10-01&ate=2026-10-31", { headers: cab }).then((r) => r.json());
  assert.equal(real.demo, undefined);
  assert.equal(real.resumo.kpis.investimento, 31);
  const ignorado = await fetch(base + "/?de=2026-10-01&ate=2026-10-31&demo=1", { headers: cab }).then((r) => r.json());
  assert.equal(ignorado.resumo.kpis.investimento, 31);
  const csv = await fetch(base + "/relatorio.csv?de=2026-10-01&ate=2026-10-31", { headers: cab });
  assert.match(csv.headers.get("content-disposition"), /resultados-2026-10-01-a-2026-10-31\.csv/);
  assert.match(await csv.text(), /;/);
  assert.equal((await fetch(base + "/?de=2026-10-31&ate=2026-10-01", { headers: cab })).status, 400);
});

test.after(() => servidor.close());
