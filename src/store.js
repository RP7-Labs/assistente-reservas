import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Armazenamento simples em arquivo para o piloto.
// Para produção, trocar pelo Postgres/Supabase (ver db/schema.sql).
const aqui = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = process.env.LEADS_FILE || path.join(aqui, "..", "data", "leads.json");

function ler() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    return { leads: [], cliques: [] };
  }
}

function gravar(db) {
  fs.writeFileSync(ARQUIVO, JSON.stringify(db, null, 2));
}

export function criarLead(dados) {
  const db = ler();
  const lead = { id: crypto.randomBytes(5).toString("hex"), criado_em: new Date().toISOString(), ...dados };
  db.leads.push(lead);
  gravar(db);
  return lead;
}

export function buscarLead(id) {
  return ler().leads.find((l) => l.id === id);
}

export function registrarClique(leadId) {
  const db = ler();
  db.cliques.push({ lead_id: leadId, em: new Date().toISOString() });
  gravar(db);
}

export function resumo() {
  const db = ler();
  const clicados = new Set(db.cliques.map((c) => c.lead_id));
  const porQuarto = {};
  for (const l of db.leads) porQuarto[l.quarto_id] = (porQuarto[l.quarto_id] || 0) + 1;
  return {
    links_gerados: db.leads.length,
    links_clicados: clicados.size,
    taxa_clique: db.leads.length ? +(clicados.size / db.leads.length).toFixed(3) : 0,
    por_quarto: porQuarto,
    por_canal: db.leads.reduce((acc, l) => ((acc[l.canal] = (acc[l.canal] || 0) + 1), acc), {}),
  };
}
