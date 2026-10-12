// Rotas do painel de resultados (/api/admin/resultados/*). Só para admins logados (o roteador do admin já exige login).
import express from "express";
import {
  listarDados, listarConversasResumo, listarOrigens, listarVisitas, listarMidia, salvarMidia,
  listarReservasExternas, salvarReservasExternas, registrarImportacao, listarImportacoes,
  lerConfig, salvarConfig, registrarAuditoria, listarAuditoria,
} from "./store.js";
import { importarGoogleAds, importarMetaAds, importarPms } from "./importacao.js";
import {
  configCompleta, unificarReservas, resumir, periodoAnterior, variacoes, qualidade, alertas, recomendacoes, sazonalidade, csvRelatorio, CONFIG_PADRAO,
} from "./resultados.js";
import { dadosDemo } from "./resultadosDemo.js";
import { hojeNoFuso } from "./paises.js";
import { carregarHotel } from "./catalogo.js";

export const resultados = express.Router();

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const rota = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { console.error(err); res.status(500).json({ erro: err.message }); }
};
const usuario = (req) => req.admin?.email ?? null;

async function lerConfigs() {
  const salvas = {};
  for (const k of Object.keys(CONFIG_PADRAO)) salvas[k] = await lerConfig(k).catch(() => null);
  return configCompleta(salvas);
}

// Junta tudo o que o motor precisa: dados reais do banco ou, com demo=1, dados de demonstração
async function carregar({ demo, hoje }) {
  if (demo) return { ...dadosDemo(hoje), demo: true };
  const desde = new Date(Date.parse(hoje) - 800 * 86_400_000).toISOString().slice(0, 10);
  const [{ leads, reservas }, conversas, origens, visitas, midia, externas, importacoes] = await Promise.all([
    listarDados(), listarConversasResumo(5000), listarOrigens().catch(() => []), listarVisitas(desde).catch(() => []),
    listarMidia(desde, hoje).catch(() => []), listarReservasExternas().catch(() => []), listarImportacoes(50).catch(() => []),
  ]);
  return { leads, reservas, conversas, origens, visitas, midia, externas, importacoes, demo: false };
}

async function calcular(req) {
  const hoje = hojeNoFuso(carregarHotel().fuso);
  const ate = DATA_RE.test(req.query.ate ?? "") ? req.query.ate : hoje;
  const de = DATA_RE.test(req.query.de ?? "") ? req.query.de : new Date(Date.parse(ate) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (de > ate) throw Object.assign(new Error("A data inicial é depois da final."), { status: 400 });
  const config = await lerConfigs();
  const dados = await carregar({ demo: req.query.demo === "1", hoje });
  const { reservas, conciliacao } = unificarReservas(dados);
  const base = { reservas, midia: dados.midia, conversas: dados.conversas, origens: dados.origens, visitas: dados.visitas, config };
  // Filtros: canal e categoria de quarto
  const filtro = (lista) => lista.filter((r) => (!req.query.canal || r.canal === req.query.canal) && (!req.query.categoria || r.categoria === req.query.categoria));
  const resumo = resumir({ ...base, reservas: filtro(reservas), de, ate });
  const ant = periodoAnterior(de, ate);
  const anterior = resumir({ ...base, reservas: filtro(reservas), ...ant });
  const q = qualidade({ resumo, conciliacao, importacoes: dados.importacoes, midia: dados.midia, hoje });
  const saz = sazonalidade({ reservas, midia: dados.midia, config, ano: Number(ate.slice(0, 4)) });
  const mesAtual = saz[Number(ate.slice(5, 7)) - 1];
  const als = alertas({ resumo, anterior, qualidade: q, config });
  const recs = recomendacoes({ resumo, alertas: als, config, ocupacao: { pct: mesAtual?.ocupacao_pct } });
  return { demo: dados.demo, hoje, resumo, anterior: { de: ant.de, ate: ant.ate, kpis: anterior.kpis }, variacoes: variacoes(resumo.kpis, anterior.kpis), qualidade: q, alertas: als, recomendacoes: recs, sazonalidade: saz, config, importacoes: dados.importacoes.slice(0, 20), categorias: [...new Set(reservas.map((r) => r.categoria).filter(Boolean))] };
}

resultados.get("/", rota(async (req, res) => {
  try {
    const r = await calcular(req);
    r.resumo.reservas = r.resumo.reservas.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 300);
    res.json(r);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ erro: err.message });
    throw err;
  }
}));

resultados.get("/relatorio.csv", rota(async (req, res) => {
  const r = await calcular(req);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="resultados-${r.resumo.de}-a-${r.resumo.ate}${r.demo ? "-DEMONSTRACAO" : ""}.csv"`);
  res.send(csvRelatorio({ resumo: r.resumo, alertas: r.alertas, qualidade: r.qualidade }));
}));

// Importação em duas etapas: sem confirmar=true só mostra o que foi lido (nada é gravado)
const LEITORES = { google: importarGoogleAds, meta: importarMetaAds, pms: (csv) => importarPms(csv, "pms") };
resultados.post("/importar", rota(async (req, res) => {
  const { tipo, arquivo, conteudo, confirmar } = req.body ?? {};
  if (!LEITORES[tipo]) return res.status(400).json({ erro: "Tipo de relatório inválido." });
  if (typeof conteudo !== "string" || !conteudo.trim()) return res.status(400).json({ erro: "Arquivo vazio." });
  const lido = LEITORES[tipo](conteudo);
  if (lido.erro) return res.status(400).json({ erro: lido.erro });
  const previa = { linhas: lido.linhas.length, erros: lido.erros.slice(0, 20), total_erros: lido.erros.length, ignoradas: lido.ignoradas, colunas: lido.colunas, periodo: lido.periodo, avisos: lido.avisos, exemplo: lido.linhas.slice(0, 5) };
  if (!confirmar) return res.json({ previa });
  if (!lido.linhas.length) return res.status(400).json({ erro: "Nenhuma linha válida para importar." });
  const r = tipo === "pms" ? await salvarReservasExternas(lido.linhas) : await salvarMidia(lido.linhas);
  const imp = await registrarImportacao({
    tipo, arquivo: String(arquivo ?? "").slice(0, 200) || null, linhas: lido.linhas.length, novas: r.novas, atualizadas: r.atualizadas,
    ignoradas: lido.ignoradas + r.duplicadas_no_arquivo, periodo_de: lido.periodo?.de ?? null, periodo_ate: lido.periodo?.ate ?? null,
    erros: lido.erros.slice(0, 50), usuario: usuario(req),
  });
  await registrarAuditoria(usuario(req), `importou relatório ${tipo}`, { arquivo, novas: r.novas, atualizadas: r.atualizadas, periodo: lido.periodo });
  res.json({ previa, importado: { ...r, id: imp?.id } });
}));

// Metas, custos e orçamento de ferramentas
const LIMITES = {
  financeiro: { comissao_ota_pct: [0, 50], taxa_pagamento_pct: [0, 20], impostos_pct: [0, 40], custo_variavel_noite: [0, 2000], retorno_minimo_pct: [0, 95] },
};
resultados.get("/config", rota(async (_req, res) => res.json(await lerConfigs())));
resultados.put("/config/:chave", rota(async (req, res) => {
  const { chave } = req.params;
  if (!CONFIG_PADRAO[chave]) return res.status(400).json({ erro: "Configuração inválida." });
  const valor = req.body ?? {};
  if (typeof valor !== "object" || Array.isArray(valor)) return res.status(400).json({ erro: "Formato inválido." });
  for (const [campo, [min, max]] of Object.entries(LIMITES[chave] ?? {})) {
    if (valor[campo] == null) continue;
    const n = Number(valor[campo]);
    if (!Number.isFinite(n) || n < min || n > max) return res.status(400).json({ erro: `${campo} precisa ficar entre ${min} e ${max}.` });
    valor[campo] = n;
  }
  if (chave === "metas" && valor.meses_alta && !(Array.isArray(valor.meses_alta) && valor.meses_alta.every((m) => Number.isInteger(m) && m >= 1 && m <= 12))) {
    return res.status(400).json({ erro: "Meses da alta temporada inválidos." });
  }
  if (chave === "ferramentas" && valor.itens && !(Array.isArray(valor.itens) && valor.itens.length <= 50 && valor.itens.every((i) => i && typeof i.nome === "string" && Number(i.mensal) >= 0))) {
    return res.status(400).json({ erro: "Lista de ferramentas inválida." });
  }
  const antes = await lerConfig(chave).catch(() => null);
  const novo = { ...(antes ?? {}), ...valor };
  await salvarConfig(chave, novo, usuario(req));
  await registrarAuditoria(usuario(req), `alterou ${chave}`, { antes, depois: novo });
  res.json((await lerConfigs())[chave]);
}));

resultados.get("/auditoria", rota(async (_req, res) => res.json(await listarAuditoria(200).catch(() => []))));
