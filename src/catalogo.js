import fs from "node:fs";
// Import estático para o arquivo entrar no pacote da Vercel
import hotelPadrao from "../data/hotel.json" with { type: "json" };
import { hotelId, rodarNoHotel, HOTEL_PADRAO } from "./tenant.js";
import { comPadroesDoPais } from "./paises.js";
import { buscarHotelRegistro, listarHoteis } from "./store.js";

// Configuração de cada hotel: catálogo (quartos, políticas), país, idioma, moeda, fuso e ids de integração.
// Vem da tabela hoteis; o hotel padrão parte de data/hotel.json (ou HOTEL_FILE) e o cadastro sobrescreve.
const cache = new Map();
const VALIDADE_MS = 60_000;

const arquivoPadrao = () => (process.env.HOTEL_FILE ? JSON.parse(fs.readFileSync(process.env.HOTEL_FILE, "utf8")) : hotelPadrao);

function montar(id, registro) {
  const base = id === HOTEL_PADRAO ? arquivoPadrao() : { quartos: [], politicas: "", checkin: "14:00", checkout: "12:00" };
  const { config = {}, dominios, ativo, criado_em, atualizado_em, ...colunas } = registro ?? {};
  const limpo = Object.fromEntries(Object.entries(colunas).filter(([, v]) => v != null && v !== ""));
  return comPadroesDoPais({ ...base, ...config, ...limpo, id, ativo: ativo ?? true, dominios: dominios ?? [] });
}

// Carrega (com cache curto) a configuração do hotel. Devolve null se o hotel não existe.
export async function prepararHotel(id = hotelId()) {
  const c = cache.get(id);
  if (c && c.ate > Date.now()) return c.hotel;
  const registro = await buscarHotelRegistro(id).catch(() => null);
  if (!registro && id !== HOTEL_PADRAO) return null;
  const hotel = montar(id, registro);
  cache.set(id, { hotel, ate: Date.now() + VALIDADE_MS });
  return hotel;
}
export const limparCacheHoteis = () => { cache.clear(); lista = { hoteis: null, ate: 0 }; };

// Roda fn dentro do hotel, com a configuração já carregada
export async function noHotel(id, fn) {
  return rodarNoHotel(id, async () => {
    await prepararHotel(id);
    return fn();
  });
}

// Lista de hotéis cadastrados (cache curto), para achar o hotel por domínio ou por id de integração
let lista = { hoteis: null, ate: 0 };
async function hoteisCadastrados() {
  if (lista.hoteis && lista.ate > Date.now()) return lista.hoteis;
  const hoteis = await listarHoteis().catch(() => []);
  lista = { hoteis, ate: Date.now() + VALIDADE_MS };
  return hoteis;
}
export const limparCacheLista = () => { lista = { hoteis: null, ate: 0 }; };

export async function hotelDoDominio(host) {
  const h = String(host ?? "").toLowerCase();
  return (await hoteisCadastrados()).find((x) => x.ativo !== false && (x.dominios ?? []).includes(h))?.id ?? null;
}

// Hotel dono de um número de WhatsApp, página da Meta etc. (campo em config.integracoes)
export async function hotelPorIntegracao(campo, valor) {
  if (!valor) return null;
  return (await hoteisCadastrados()).find((x) => String(x.config?.integracoes?.[campo] ?? "") === String(valor))?.id ?? null;
}

// Hotéis ativos, para as tarefas agendadas (o padrão sempre entra)
export async function hoteisAtivos() {
  const ids = (await hoteisCadastrados()).filter((x) => x.ativo !== false).map((x) => x.id);
  return [HOTEL_PADRAO, ...ids.filter((id) => id !== HOTEL_PADRAO)];
}

// Configuração do hotel atual (síncrona: o middleware e noHotel já carregaram)
export function carregarHotel() {
  const id = hotelId();
  return cache.get(id)?.hotel ?? montar(id, null);
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(s) {
  if (!DATA_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Valida o pedido contra o catálogo. É aqui que garantimos que o hóspede
// recebe o link do quarto que pediu, e não de outro.
export function validarPedido(hotel, { quarto_id, checkin, checkout, adultos, criancas = 0 }, hoje = new Date()) {
  const quarto = hotel.quartos.find((q) => q.id === quarto_id);
  if (!quarto) {
    return { ok: false, erro: `Quarto "${quarto_id}" não existe. Opções: ${hotel.quartos.map((q) => q.id).join(", ")}` };
  }
  if (!dataValida(checkin) || !dataValida(checkout)) {
    return { ok: false, erro: "Datas devem estar no formato AAAA-MM-DD." };
  }
  const hojeStr = hoje.toISOString().slice(0, 10);
  if (checkin < hojeStr) return { ok: false, erro: "O check-in não pode ser no passado." };
  if (checkout <= checkin) return { ok: false, erro: "O check-out precisa ser depois do check-in." };
  if (!Number.isInteger(adultos) || adultos < 1) return { ok: false, erro: "Informe pelo menos 1 adulto." };
  if (!Number.isInteger(criancas) || criancas < 0) return { ok: false, erro: "Número de crianças inválido." };
  if (adultos > quarto.capacidade_adultos || adultos + criancas > quarto.capacidade_total) {
    const cabem = hotel.quartos
      .filter((q) => adultos <= q.capacidade_adultos && adultos + criancas <= q.capacidade_total)
      .map((q) => q.nome);
    return {
      ok: false,
      erro: `${quarto.nome} comporta até ${quarto.capacidade_adultos} adultos e ${quarto.capacidade_total} pessoas no total.` +
        (cabem.length ? ` Opções que comportam o grupo: ${cabem.join(", ")}.` : " Nenhum quarto comporta esse grupo sozinho."),
    };
  }
  const noites = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000);
  return { ok: true, quarto, noites };
}

export function montarLinkMotor(hotel, quarto, { checkin, checkout, adultos, criancas = 0 }, leadId) {
  const base = hotel.motor.link_modelo
    .replace("{codigo_motor}", encodeURIComponent(quarto.codigo_motor))
    .replace("{checkin}", checkin)
    .replace("{checkout}", checkout)
    .replace("{adultos}", String(adultos))
    .replace("{criancas}", String(criancas));
  const url = new URL(base);
  // Atribuição: identifica que a reserva veio do assistente
  url.searchParams.set("utm_source", "assistente");
  url.searchParams.set("utm_medium", "chat");
  url.searchParams.set("utm_campaign", "canal_direto");
  if (leadId) url.searchParams.set("utm_content", leadId);
  return url.toString();
}

// Total da estadia. Quarto com preco_mensal: a partir de minimo_noites_mensal (padrão 28) vale o preço do mês,
// proporcional aos dias (estadia longa, como o Studio mensal); abaixo disso, diária × noites.
export const MINIMO_MENSAL = 28;
export function precoTotal(quarto, noites) {
  if (!quarto) return 0;
  if (quarto.preco_mensal && noites >= (quarto.minimo_noites_mensal ?? MINIMO_MENSAL)) return Math.round((quarto.preco_mensal / 30) * noites);
  return (quarto.preco_a_partir ?? 0) * noites;
}
