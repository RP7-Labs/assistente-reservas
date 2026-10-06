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
    return { leads: [], cliques: [], conversas: {}, atendimentos: {}, reservas: [], admins: [], ...JSON.parse(fs.readFileSync(ARQUIVO, "utf8")) };
  } catch {
    return { leads: [], cliques: [], conversas: {}, atendimentos: {}, reservas: [], admins: [] };
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
  db.atendimentos[id] = { ...db.atendimentos[id], canal, atualizado_em: new Date().toISOString() };
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

// ---- Back-office ----

export async function marcarAtendente(id, precisa, motivo = null) {
  if (sb) {
    verificar(await sb.from("conversas").update({ precisa_atendente: precisa, motivo_atendente: motivo }).eq("id", id));
    return;
  }
  const db = lerArquivo();
  db.atendimentos[id] = { ...db.atendimentos[id], precisa_atendente: precisa, motivo_atendente: motivo };
  gravarArquivo(db);
}

export async function listarConversas(limite = 200) {
  if (sb) {
    return verificar(
      await sb.from("conversas")
        .select("id, canal, mensagens, atualizado_em, precisa_atendente, motivo_atendente")
        .order("atualizado_em", { ascending: false })
        .limit(limite),
    );
  }
  const db = lerArquivo();
  return Object.entries(db.conversas)
    .map(([id, mensagens]) => ({ id, mensagens, canal: "web", precisa_atendente: false, motivo_atendente: null, ...db.atendimentos[id] }))
    .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))
    .slice(0, limite);
}

export async function listarDados() {
  if (sb) {
    const [leads, cliques, reservas] = await Promise.all([
      sb.from("leads").select("*").order("criado_em", { ascending: false }).limit(1000),
      sb.from("cliques").select("lead_id, em"),
      sb.from("reservas").select("*").order("checkin", { ascending: true }),
    ]);
    return { leads: verificar(leads), cliques: verificar(cliques), reservas: verificar(reservas) };
  }
  const { leads, cliques, reservas } = lerArquivo();
  return { leads: [...leads].reverse(), cliques, reservas };
}

export async function salvarReserva(reserva) {
  const linha = { ...reserva, atualizado_em: new Date().toISOString() };
  if (sb) {
    verificar(await sb.from("reservas").upsert(linha));
    return linha;
  }
  const db = lerArquivo();
  const i = db.reservas.findIndex((r) => r.codigo_motor === linha.codigo_motor);
  if (i >= 0) db.reservas[i] = { ...db.reservas[i], ...linha };
  else db.reservas.push({ criado_em: linha.atualizado_em, ...linha });
  gravarArquivo(db);
  return linha;
}

export async function atualizarStatusReserva(codigo, status) {
  if (sb) {
    const r = verificar(await sb.from("reservas").update({ status, atualizado_em: new Date().toISOString() }).eq("codigo_motor", codigo).select());
    return r.length > 0;
  }
  const db = lerArquivo();
  const r = db.reservas.find((x) => x.codigo_motor === codigo);
  if (!r) return false;
  r.status = status;
  r.atualizado_em = new Date().toISOString();
  gravarArquivo(db);
  return true;
}

// ---- Usuários do back-office ----

export async function buscarAdminPorEmail(email) {
  if (sb) return verificar(await sb.from("admins").select("*").eq("email", email).maybeSingle());
  return lerArquivo().admins.find((a) => a.email === email) ?? null;
}

export async function buscarAdmin(id) {
  if (sb) return verificar(await sb.from("admins").select("*").eq("id", id).maybeSingle());
  return lerArquivo().admins.find((a) => a.id === id) ?? null;
}

export async function listarAdmins() {
  const campos = "id, nome, email, status, aprovado_por, aprovado_em, criado_em";
  if (sb) return verificar(await sb.from("admins").select(campos).order("criado_em", { ascending: true }));
  return lerArquivo().admins.map(({ senha_hash, ...a }) => a);
}

export async function criarAdmin(dados) {
  const admin = { id: crypto.randomUUID(), criado_em: new Date().toISOString(), aprovado_por: null, aprovado_em: null, ...dados };
  if (sb) {
    verificar(await sb.from("admins").insert(admin));
    return admin;
  }
  const db = lerArquivo();
  db.admins.push(admin);
  gravarArquivo(db);
  return admin;
}

export async function atualizarAdmin(id, campos) {
  if (sb) {
    verificar(await sb.from("admins").update(campos).eq("id", id));
    return;
  }
  const db = lerArquivo();
  const a = db.admins.find((x) => x.id === id);
  if (a) Object.assign(a, campos);
  gravarArquivo(db);
}
