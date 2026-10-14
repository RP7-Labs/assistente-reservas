import fs from "node:fs";
// Import estático para o arquivo entrar no pacote da Vercel
import hotelPadrao from "../data/hotel.json" with { type: "json" };
import { hotelId, rodarNoHotel, HOTEL_PADRAO } from "./tenant.js";
import { comPadroesDoPais } from "./paises.js";
import { pascoa } from "./periodos.js";
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
  // Locação por temporada vai até 90 dias (Lei 8.245/1991, art. 48); mais que isso é outro tipo de contrato
  if (hotel.tipo === "temporada" && (Date.parse(checkout) - Date.parse(checkin)) / 86_400_000 > 90) {
    return { ok: false, erro: "Aluguel por temporada vai até 90 dias. Para períodos maiores, fale com a equipe." };
  }
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
  // Sem preço cadastrado não há link de pagamento: o valor nunca é inventado, a equipe passa
  if (!temPreco(quarto, noites, hotel) || detalharPreco(quarto, noites, { hotel, checkin, adultos, criancas }).incompleto) {
    return { ok: false, sem_preco: true, quarto, noites, erro: `O valor do ${quarto.nome} para essas datas ainda não está no sistema. Vou chamar a equipe do hotel para passar o preço e concluir a reserva.` };
  }
  return { ok: true, quarto, noites, total: precoTotal(quarto, noites, { hotel, checkin, adultos, criancas }) };
}

export function montarLinkMotor(hotel, quarto, { checkin, checkout, adultos, criancas = 0 }, leadId) {
  // Sem o link do motor cadastrado, a reserva segue pelo checkout próprio (/r/:id)
  if (!hotel.motor?.link_modelo || !quarto) return null;
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
// proporcional aos dias (estadia longa, como o Studio mensal); abaixo disso, a soma das diárias.
// Diária: tabela por temporada (hotel.tarifas, ou quarto.tarifas) quando houver; senão preco_a_partir.
export const MINIMO_MENSAL = 28;
const positivo = (v) => Number(v) > 0;
const tarifasDe = (quarto, hotel) => quarto?.tarifas ?? hotel?.tarifas ?? null;
const ehMensal = (quarto, noites) => positivo(quarto?.preco_mensal) && noites >= (quarto.minimo_noites_mensal ?? MINIMO_MENSAL);

// Datas do Carnaval do ano: noites de sábado a terça (Páscoa − 50 a Páscoa − 47)
const somarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function noitesDeCarnaval(ano) {
  const p = pascoa(ano).toISOString().slice(0, 10);
  return [-50, -49, -48, -47].map((n) => somarDias(p, n));
}

// Valor de uma noite pela tabela. Ordem: evento (Réveillon, Carnaval), faixa da temporada, padrão.
// Faixas e eventos usam "MM-DD" e podem virar o ano (ex.: 12-29 a 01-01).
export function tarifaDaNoite(tarifas, data) {
  if (!tarifas) return null;
  const md = data.slice(5);
  const dentro = (de, ate) => (de <= ate ? md >= de && md <= ate : md >= de || md <= ate);
  for (const e of tarifas.eventos ?? []) {
    if (e.carnaval ? noitesDeCarnaval(Number(data.slice(0, 4))).includes(data) : dentro(e.de, e.ate)) return { valor: Number(e.valor), nome: e.nome ?? "evento" };
  }
  const f = (tarifas.faixas ?? []).find((x) => dentro(x.de, x.ate));
  if (f) return { valor: Number(f.valor), nome: f.nome ?? null };
  return positivo(tarifas.padrao) ? { valor: Number(tarifas.padrao), nome: null } : null;
}

// Pessoas que pagam na tarifa por pessoa: adultos e crianças acima da idade isenta (sem idade informada, criança paga)
const pagantes = (tarifas, { adultos = 1, criancas = 0 } = {}) => (tarifas?.por_pessoa ? Math.max(1, Number(adultos) + Number(criancas)) : 1);

// O quarto tem preço cadastrado para essa estadia?
export function temPreco(quarto, noites = 1, hotel = null) {
  if (!quarto) return false;
  if (ehMensal(quarto, noites)) return true;
  if (tarifasDe(quarto, hotel)) return true;
  return positivo(quarto.preco_a_partir);
}

// Total e o valor de cada noite. pedido = { checkin, adultos, criancas }; sem checkin usa preco_a_partir.
export function detalharPreco(quarto, noites, { hotel = null, checkin = null, adultos = 1, criancas = 0 } = {}) {
  if (!quarto) return { total: 0, noites: [] };
  if (ehMensal(quarto, noites)) return { total: Math.round((quarto.preco_mensal / 30) * noites), mensal: true, noites: [] };
  const t = tarifasDe(quarto, hotel);
  if (t && checkin) {
    const n = pagantes(t, { adultos, criancas });
    const lista = Array.from({ length: noites }, (_, i) => {
      const data = somarDias(checkin, i);
      const tf = tarifaDaNoite(t, data);
      return { data, valor: tf ? tf.valor * n : null, por_pessoa: tf?.valor ?? null, nome: tf?.nome ?? null };
    });
    if (lista.some((x) => x.valor == null)) return { total: 0, noites: lista, incompleto: true };
    return { total: lista.reduce((s, x) => s + x.valor, 0), noites: lista, por_pessoa: Boolean(t.por_pessoa), pessoas: n };
  }
  return { total: (quarto.preco_a_partir ?? 0) * noites, noites: [] };
}
export const precoTotal = (quarto, noites, pedido = {}) => detalharPreco(quarto, noites, pedido).total;

const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR")}`;
// "a partir de R$ 99 por pessoa" / "R$ 160 a diária" / null (sem preço)
export function textoAPartir(quarto, hotel) {
  const a = aPartirDe(quarto, hotel);
  return a ? `a partir de ${brl(a.valor)} ${a.por_pessoa ? "por pessoa, por noite" : "a diária"}` : null;
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const FIM_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const dm = (md) => md.split("-").reverse().join("/");
// "01/02 a 29/02" vira "Fevereiro"
function periodoTexto(de, ate) {
  const [m1, d1] = de.split("-").map(Number), [m2, d2] = ate.split("-").map(Number);
  if (m1 === m2 && d1 === 1 && d2 >= FIM_MES[m1 - 1] - (m1 === 2 ? 1 : 0)) return MESES[m1 - 1].replace(/^./, (c) => c.toUpperCase());
  return `${dm(de)} a ${dm(ate)}`;
}

// Tabela por temporada em texto, para o assistente responder sobre preços
export function resumoTarifas(hotel) {
  const t = hotel?.tarifas;
  if (!t) return null;
  const un = t.por_pessoa ? " por pessoa, por noite" : " a diária";
  return [
    ...(t.eventos ?? []).map((e) => `${e.nome}${e.carnaval ? " (noites de sábado a terça)" : ` (${dm(e.de)} a ${dm(e.ate)})`}: ${brl(e.valor)}${un}`),
    ...(t.faixas ?? []).map((f) => `${periodoTexto(f.de, f.ate)}: ${brl(f.valor)}${un}`),
    ...(Number(t.padrao) > 0 ? [`Demais datas: ${brl(t.padrao)}${un}`] : []),
  ].join("\n");
}

// Menor diária da tabela (para "a partir de"), por pessoa quando a tarifa é por pessoa
export function aPartirDe(quarto, hotel) {
  const t = tarifasDe(quarto, hotel);
  if (!t) return positivo(quarto?.preco_a_partir) ? { valor: Number(quarto.preco_a_partir), por_pessoa: false } : null;
  const valores = [t.padrao, ...(t.faixas ?? []).map((f) => f.valor)].map(Number).filter((v) => v > 0);
  return valores.length ? { valor: Math.min(...valores), por_pessoa: Boolean(t.por_pessoa) } : null;
}

// ---- Tabela de tarifas como texto (editor do admin) ----
// Uma linha por regra: "01/12 a 10/12: 115", "Réveillon 29/12 a 01/01: 500", "Carnaval: 299", "Demais datas: 99"
const num = (v) => Number(String(v).replace(/\./g, "").replace(",", "."));
const md2 = (d, m) => `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export function tarifasParaTexto(t) {
  if (!t) return "";
  return [
    ...(t.eventos ?? []).map((e) => (e.carnaval ? `${e.nome ?? "Carnaval"}: ${e.valor}` : `${e.nome} ${dm(e.de)} a ${dm(e.ate)}: ${e.valor}`)),
    ...(t.faixas ?? []).map((f) => `${dm(f.de)} a ${dm(f.ate)}: ${f.valor}`),
    ...(Number(t.padrao) > 0 ? [`Demais datas: ${t.padrao}`] : []),
  ].join("\n");
}
export function lerTarifas(texto, porPessoa) {
  const t = { por_pessoa: Boolean(porPessoa), padrao: null, faixas: [], eventos: [] };
  for (const [i, bruta] of String(texto ?? "").split("\n").entries()) {
    const l = bruta.trim();
    if (!l) continue;
    const erro = { erro: `Tarifas, linha ${i + 1}: "${l}" não entendida. Use "01/12 a 10/12: 115", "Réveillon 29/12 a 01/01: 500", "Carnaval: 299" ou "Demais datas: 99".` };
    const valorOk = (v) => Number.isFinite(v) && v > 0 && v < 100_000;
    let m = /^(?:demais datas|padr[aã]o|resto do ano)\s*:\s*(?:R\$\s*)?([\d.,]+)$/i.exec(l);
    if (m) { if (!valorOk(num(m[1]))) return erro; t.padrao = num(m[1]); continue; }
    m = /^carnaval\s*:\s*(?:R\$\s*)?([\d.,]+)$/i.exec(l);
    if (m) { if (!valorOk(num(m[1]))) return erro; t.eventos.push({ nome: "Carnaval", carnaval: true, valor: num(m[1]) }); continue; }
    m = /^(?:([^\d:]*?[A-Za-zÀ-ú][^\d:]*?)\s+)?(\d{1,2})\/(\d{1,2})\s*(?:a|até|-)\s*(\d{1,2})\/(\d{1,2})\s*:\s*(?:R\$\s*)?([\d.,]+)$/i.exec(l);
    if (!m) return erro;
    const [, nome, d1, m1, d2, m2, v] = m;
    if ([m1, m2].some((x) => x < 1 || x > 12) || [d1, d2].some((x) => x < 1 || x > 31) || !valorOk(num(v))) return erro;
    const regra = { de: md2(d1, m1), ate: md2(d2, m2), valor: num(v) };
    if (nome) t.eventos.push({ nome: nome.trim().slice(0, 40), ...regra }); else t.faixas.push(regra);
  }
  if (!t.padrao && !t.faixas.length && !t.eventos.length) return { tarifas: null };
  return { tarifas: t };
}
