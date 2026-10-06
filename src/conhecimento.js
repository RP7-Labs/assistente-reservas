// RAG simples e sem custo: busca BM25 sobre data/conhecimento.md, sem IA.
// Cada seção "##" do arquivo é um documento; a linha "Perguntas:" reforça a busca.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = process.env.CONHECIMENTO_FILE || path.join(aqui, "..", "data", "conhecimento.md");

const PARADAS = new Set(("a o as os um uma uns umas de da do das dos em no na nos nas por para pra pro com sem e ou que " +
  "se eu voce voces vc vcs me te nos ele ela eles elas meu minha seu sua isso esse essa este esta aqui ai la tem ter " +
  "tenho temos ha qual quais como onde quando quanto quanta quantos quantas ja ainda mais muito pouco ser e sao foi " +
  "esta estao estou posso pode podem gostaria queria quero saber sobre hotel voces vcs oi ola bom boa dia tarde noite favor obrigado " +
  "algum alguma tudo todo toda nao sim so tambem hoje").split(" "));

const normalizar = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Radical por prefixo: "cancelar", "cancelamento", "cancelo" → "cance"
const radical = (p) => { const r = p.length > 3 ? p.replace(/[sm]$/, "") : p; return r.length > 5 ? r.slice(0, 5) : r; };

export function termos(texto) {
  return normalizar(texto)
    .replace(/wi-?fi/g, "wifi")
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 1 && !PARADAS.has(p))
    .map(radical);
}

export function carregarBase(texto) {
  const secoes = texto.split(/^## /m).slice(1);
  return secoes.map((s) => {
    const [titulo, ...linhas] = s.split("\n");
    let perguntas = [];
    const corpo = [];
    for (const l of linhas) {
      if (/^perguntas:/i.test(l)) perguntas = l.replace(/^perguntas:/i, "").split("|").map((x) => x.trim()).filter(Boolean);
      else corpo.push(l);
    }
    const resposta = corpo.join("\n").trim();
    // título e perguntas pesam mais que o corpo
    const tokens = [...termos(titulo), ...termos(titulo), ...perguntas.flatMap((p) => [...termos(p), ...termos(p)]), ...termos(resposta)];
    return { titulo: titulo.trim(), perguntas, resposta, tokens };
  }).filter((d) => d.resposta);
}

function indexar(docs) {
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const media = docs.reduce((s, d) => s + d.tokens.length, 0) / (docs.length || 1);
  return { docs, df, media };
}

let indice;
function indicePadrao() {
  if (!indice) {
    let texto = "";
    try { texto = fs.readFileSync(ARQUIVO, "utf8"); } catch { /* sem base, sem respostas */ }
    indice = indexar(carregarBase(texto));
  }
  return indice;
}

export const criarIndice = (texto) => indexar(carregarBase(texto));
export const topicos = (idx = indicePadrao()) => idx.docs.map((d) => d.titulo);
export const porTitulo = (titulo, idx = indicePadrao()) => idx.docs.find((d) => normalizar(d.titulo) === normalizar(titulo)) ?? null;

// Devolve o documento mais parecido com a pergunta, ou null se nada for parecido o bastante
export function buscar(pergunta, idx = indicePadrao(), minimo = 2.2) {
  const q = [...new Set(termos(pergunta))];
  if (!q.length || !idx.docs.length) return null;
  const N = idx.docs.length, k1 = 1.2, b = 0.75;
  let melhor = null;
  for (const d of idx.docs) {
    let score = 0;
    for (const t of q) {
      const f = d.tokens.filter((x) => x === t).length;
      if (!f) continue;
      const n = idx.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.tokens.length) / idx.media)));
    }
    if (!melhor || score > melhor.score) melhor = { ...d, score };
  }
  return melhor && melhor.score >= minimo ? melhor : null;
}
