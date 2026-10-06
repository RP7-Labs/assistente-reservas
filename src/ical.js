// Sincronização de calendário por iCal (.ics), o padrão aberto que Airbnb, Booking.com e outros aceitam.
// Importar: lê o calendário do anúncio e bloqueia as datas aqui.
// Exportar: publica as datas em que o tipo de quarto lota, para o anúncio fechar essas noites.
import crypto from "node:crypto";

const DIA = 86_400_000;
const somarDias = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * DIA).toISOString().slice(0, 10);
const paraData = (v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
const paraIcal = (d) => d.replaceAll("-", "");

// Lê os eventos (VEVENT) de um arquivo .ics. Datas viram AAAA-MM-DD; o fim é exclusivo (dia da saída).
export function lerIcal(texto) {
  // linhas dobradas: continuação começa com espaço ou tab
  const linhas = String(texto ?? "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const eventos = [];
  let ev = null;
  for (const l of linhas) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT") {
      if (ev?.inicio) eventos.push({ uid: ev.uid ?? null, inicio: ev.inicio, fim: ev.fim ?? somarDias(ev.inicio, 1), resumo: ev.resumo ?? "" });
      ev = null;
    } else if (ev) {
      const i = l.indexOf(":");
      if (i < 0) continue;
      const chave = l.slice(0, i).split(";")[0].toUpperCase();
      const valor = l.slice(i + 1).trim();
      const data = valor.match(/^(\d{8})/)?.[1];
      if (chave === "DTSTART" && data) ev.inicio = paraData(data);
      else if (chave === "DTEND" && data) ev.fim = paraData(data);
      else if (chave === "UID") ev.uid = valor;
      else if (chave === "SUMMARY") ev.resumo = valor.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ");
    }
  }
  return eventos.filter((e) => e.fim > e.inicio);
}

// Junta datas (noites) em intervalos contínuos [inicio, fim)
export function intervalos(datas) {
  const ord = [...new Set(datas)].sort();
  const saida = [];
  for (const d of ord) {
    const ult = saida.at(-1);
    if (ult && ult.fim === d) ult.fim = somarDias(d, 1);
    else saida.push({ inicio: d, fim: somarDias(d, 1) });
  }
  return saida;
}

// Monta um .ics com um evento de dia inteiro por intervalo fechado
export function gerarIcal({ nome, fechados, agora = new Date() }) {
  const carimbo = agora.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const eventos = fechados.flatMap((f) => [
    "BEGIN:VEVENT",
    `UID:${f.inicio}-${f.fim}@reservas-diretas`,
    `DTSTAMP:${carimbo}`,
    `DTSTART;VALUE=DATE:${paraIcal(f.inicio)}`,
    `DTEND;VALUE=DATE:${paraIcal(f.fim)}`,
    "SUMMARY:Indisponível",
    "END:VEVENT",
  ]);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reservas Diretas//PT-BR", "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${String(nome).replace(/[\r\n,;]/g, " ")}`,
    ...eventos, "END:VCALENDAR", "",
  ].join("\r\n");
}

export const novoToken = () => crypto.randomBytes(18).toString("base64url");

// Só aceita https e hosts públicos (evita usar o servidor para acessar a rede interna)
export function urlValida(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:") return false;
    return !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[|0\.)/i.test(x.hostname) && x.hostname.includes(".");
  } catch {
    return false;
  }
}

// Baixa o calendário do canal e devolve os bloqueios de hoje em diante
export async function baixarBloqueios(canal, hoje, buscarFn = fetch) {
  if (!urlValida(canal.url_importar)) throw new Error("URL do calendário inválida (use o link https do anúncio).");
  const r = await buscarFn(canal.url_importar, { headers: { Accept: "text/calendar" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`O calendário respondeu ${r.status}`);
  const texto = await r.text();
  if (!texto.includes("BEGIN:VCALENDAR")) throw new Error("O link não devolveu um calendário iCal.");
  return lerIcal(texto)
    .filter((e) => e.fim > hoje)
    .map((e) => ({ canal_id: canal.id, quarto_id: canal.quarto_id, uid: e.uid, checkin: e.inicio, checkout: e.fim, resumo: e.resumo.slice(0, 200) }));
}

// Noites em que o tipo de quarto fica sem vaga, sem contar os bloqueios do próprio canal
// (senão uma reserva do Airbnb voltaria para ele como "lotado" e fecharia o anúncio em loop).
export function noitesFechadas({ quarto, reservas, leadsEmProcesso = [], bloqueios, canalId, hoje, dias = 365 }) {
  const ATIVAS = new Set(["confirmada", "concluida"]);
  const unidades = quarto.unidades ?? 0;
  const ocupa = (x, d) => x.quarto_id === quarto.id && x.checkin <= d && d < x.checkout;
  const fechadas = [];
  for (let i = 0; i < dias; i++) {
    const d = somarDias(hoje, i);
    const usadas = reservas.filter((r) => ATIVAS.has(r.status) && ocupa(r, d)).length
      + leadsEmProcesso.filter((l) => ocupa(l, d)).length
      + bloqueios.filter((b) => b.canal_id !== canalId && ocupa(b, d)).length;
    if (usadas >= unidades) fechadas.push(d);
  }
  return fechadas;
}
