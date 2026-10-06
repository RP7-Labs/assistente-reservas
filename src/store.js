import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// Com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY definidos, grava no Supabase.
// Sem eles (desenvolvimento local e testes), grava em data/local.json.
const usarSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const sb = usarSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      db: { schema: process.env.SUPABASE_SCHEMA || "reservas" },
    })
  : null;

const aqui = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = process.env.LOCAL_DB_FILE || path.join(aqui, "..", "data", "local.json");

function lerArquivo() {
  try {
    return { leads: [], cliques: [], conversas: {}, ...JSON.parse(fs.readFileSync(ARQUIVO, "utf8")) };
  } catch {
    return { leads: [], cliques: [], conversas: {} };
  }
}
function gravarArquivo(db) {
  fs.writeFileSync(ARQUIVO, JSON.stringify(db, null, 2));
}

function verificar({ data, error }) {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

export async function criarLead(dados) {
  const lead = { id: crypto.randomBytes(5).toString("hex"), criado_em: new Date().toISOString(), ...dados };
  if (sb) {
    verificar(await sb.from("leads").insert(lead));
  } else {
    const db = lerArquivo();
    db.leads.push(lead);
    gravarArquivo(db);
  }
  return lead;
}

export async function buscarLead(id) {
  if (sb) return verificar(await sb.from("leads").select("*").eq("id", id).maybeSingle());
  return lerArquivo().leads.find((l) => l.id === id);
}

export async function registrarClique(leadId) {
  if (sb) {
    verificar(await sb.from("cliques").insert({ lead_id: leadId }));
    return;
  }
  const db = lerArquivo();
  db.cliques.push({ lead_id: leadId, em: new Date().toISOString() });
  gravarArquivo(db);
}

// Histórico da conversa no formato de mensagens da API do Claude
export async function carregarConversa(id) {
  if (sb) {
    const linha = verificar(await sb.from("conversas").select("mensagens").eq("id", id).maybeSingle());
    return linha?.mensagens ?? [];
  }
  return lerArquivo().conversas[id] ?? [];
}

export async function salvarConversa(id, canal, mensagens) {
  if (sb) {
    verificar(await sb.from("conversas").upsert({ id, canal, mensagens, atualizado_em: new Date().toISOString() }));
    return;
  }
  const db = lerArquivo();
  db.conversas[id] = mensagens;
  gravarArquivo(db);
}

export async function resumo() {
  let leads, cliques;
  if (sb) {
    leads = verificar(await sb.from("leads").select("id, quarto_id, canal"));
    cliques = verificar(await sb.from("cliques").select("lead_id"));
  } else {
    ({ leads, cliques } = lerArquivo());
  }
  const clicados = new Set(cliques.map((c) => c.lead_id));
  const contar = (campo) => leads.reduce((acc, l) => ((acc[l[campo]] = (acc[l[campo]] || 0) + 1), acc), {});
  return {
    links_gerados: leads.length,
    links_clicados: clicados.size,
    taxa_clique: leads.length ? +(clicados.size / leads.length).toFixed(3) : 0,
    por_quarto: contar("quarto_id"),
    por_canal: contar("canal"),
  };
}

// Consulta leve para a página de status
export async function verificarBanco() {
  const inicio = Date.now();
  try {
    if (sb) {
      verificar(await sb.from("leads").select("id").limit(1));
    } else {
      lerArquivo();
    }
    return { ok: true, detalhe: sb ? "Supabase" : "arquivo local", ms: Date.now() - inicio };
  } catch (err) {
    return { ok: false, detalhe: err.message, ms: Date.now() - inicio };
  }
}
