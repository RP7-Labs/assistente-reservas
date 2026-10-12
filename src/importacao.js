// Importação de relatórios (CSV) do Google Ads, do Meta Ads e do PMS/motor de reservas.
// Enquanto as APIs oficiais não estão conectadas, é por aqui que o gasto e as reservas reais entram.
// Reimportar o mesmo arquivo não duplica nada: cada linha tem uma chave (dia + campanha, ou código da reserva).

// ---- Leitura de CSV (vírgula, ponto e vírgula ou tab; aspas; linhas de título antes do cabeçalho) ----

export function lerCsv(texto) {
  const limpo = String(texto ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const primeiras = limpo.split("\n").slice(0, 10);
  const contar = (sep) => Math.max(...primeiras.map((l) => l.split(sep).length));
  const sep = ["\t", ";", ","].sort((a, b) => contar(b) - contar(a))[0];
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.map((l) => l.map((v) => v.trim())).filter((l) => l.some((v) => v !== ""));
}

export const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Acha a linha de cabeçalho (os relatórios do Google Ads trazem 1 ou 2 linhas de título antes)
function acharCabecalho(linhas, aliases, obrigatorios) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const mapa = mapearColunas(linhas[i], aliases);
    if (obrigatorios.every((o) => mapa[o] != null)) return { inicio: i, mapa };
  }
  return null;
}

function mapearColunas(cab, aliases) {
  const norm = cab.map(normalizar);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(aliases)) {
    const i = nomes.map(normalizar).map((n) => norm.indexOf(n)).find((x) => x >= 0);
    if (i != null) mapa[campo] = i;
  }
  return mapa;
}

// "R$ 1.234,56", "1,234.56", "1234.5", "12,3%" → número
export function numero(v) {
  if (v == null) return null;
  let s = String(v).replace(/[R$\s%BRL]/g, "").replace(/[^\d.,-]/g, "");
  if (!s || s === "-" || s === "--") return null;
  // Só separador de milhar (1.234 ou 1,234,567): sem casas decimais
  if (/^-?\d{1,3}([.,])\d{3}(\1\d{3})*$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  const v1 = s.lastIndexOf(","), p1 = s.lastIndexOf(".");
  if (v1 > p1) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MESES = { jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, out: 10, nov: 11, dec: 12, dez: 12 };
// "2026-10-01", "01/10/2026", "1/10/26", "Oct 1, 2026", "1 de out. de 2026" → "2026-10-01"
export function dataIso(v) {
  const s = String(v ?? "").trim().toLowerCase();
  let m;
  const p = (n) => String(n).padStart(2, "0");
  const ano = (a) => (String(a).length === 2 ? 2000 + Number(a) : Number(a));
  const ok = (a, me, d) => (me >= 1 && me <= 12 && d >= 1 && d <= 31 ? `${ano(a)}-${p(me)}-${p(d)}` : null);
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ok(m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) return ok(m[3], +m[2], +m[1]);
  if ((m = s.match(/^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/))) return MESES[m[1]] ? ok(m[3], MESES[m[1]], +m[2]) : null;
  if ((m = s.match(/^(\d{1,2}) (?:de )?([a-z]{3})[a-z]*\.?(?: de)? (\d{4})/))) return MESES[m[2]] ? ok(m[3], MESES[m[2]], +m[1]) : null;
  return null;
}

const texto = (v, max = 200) => { const t = String(v ?? "").trim(); return t && t !== "--" ? t.slice(0, max) : null; };

// ---- Google Ads: relatório de campanhas (ou grupos de anúncios / palavras-chave) com segmento por dia ----

const ALIAS_GOOGLE = {
  data: ["Dia", "Day", "Data", "Date"],
  campanha: ["Campanha", "Campaign", "Nome da campanha", "Campaign name"],
  campanha_id: ["ID da campanha", "Campaign ID"],
  grupo: ["Grupo de anúncios", "Ad group", "Grupo de anuncios"],
  grupo_id: ["ID do grupo de anúncios", "Ad group ID"],
  anuncio: ["Palavra-chave", "Keyword", "Palavra-chave da rede de pesquisa", "Search keyword", "Anúncio", "Ad"],
  anuncio_id: ["ID da palavra-chave", "Keyword ID", "ID do anúncio", "Ad ID"],
  impressoes: ["Impr.", "Impressões", "Impressions", "Impr"],
  cliques: ["Cliques", "Clicks", "Interações", "Interactions"],
  custo: ["Custo", "Cost"],
  conversoes: ["Conversões", "Conversions", "Conv."],
  valor: ["Valor de conv.", "Valor conv.", "Conv. value", "Valor de conversão", "Conversion value", "Valor das conversões"],
};

// ---- Meta Ads (Gerenciador de Anúncios → Exportar), com detalhamento por dia ----

const ALIAS_META = {
  data: ["Dia", "Day", "Início dos relatórios", "Reporting starts", "Data"],
  fim: ["Término dos relatórios", "Reporting ends"],
  campanha: ["Nome da campanha", "Campaign name", "Campanha"],
  campanha_id: ["Identificação da campanha", "ID da campanha", "Campaign ID"],
  grupo: ["Nome do conjunto de anúncios", "Ad set name", "Conjunto de anúncios"],
  grupo_id: ["Identificação do conjunto de anúncios", "ID do conjunto de anúncios", "Ad set ID"],
  anuncio: ["Nome do anúncio", "Ad name"],
  anuncio_id: ["Identificação do anúncio", "ID do anúncio", "Ad ID"],
  impressoes: ["Impressões", "Impressions"],
  alcance: ["Alcance", "Reach"],
  cliques: ["Cliques no link", "Link clicks", "Cliques (todos)", "Clicks (all)", "Cliques"],
  custo: ["Valor usado", "Amount spent", "Valor gasto"],
  conversoes: ["Resultados", "Results"],
  valor: ["Valor de conversão de compras", "Purchases conversion value", "Valor de conversão de compras no site"],
};

const TOTAL_RE = /^(total|totais|total geral|grand total|resultados de)/i;

function importarMidia(plataforma, csv, aliases) {
  const linhas = lerCsv(csv);
  const cab = acharCabecalho(linhas, aliases, ["data", "campanha", "custo"]);
  if (!cab) {
    return { erro: `Não achei as colunas de dia, campanha e custo. Exporte o relatório com o segmento por dia. Colunas encontradas: ${(linhas[0] ?? []).slice(0, 12).join(", ")}` };
  }
  const { inicio, mapa } = cab;
  const val = (l, c) => (mapa[c] != null ? l[mapa[c]] : null);
  const saida = [], erros = [];
  let ignoradas = 0, avisoPeriodo = false;
  for (let i = inicio + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (TOTAL_RE.test(l[0] ?? "") || TOTAL_RE.test(val(l, "campanha") ?? "")) { ignoradas++; continue; }
    const data = dataIso(val(l, "data"));
    const campanha = texto(val(l, "campanha"));
    if (!data || !campanha) { erros.push({ linha: i + 1, erro: !data ? `data inválida: "${val(l, "data") ?? ""}"` : "sem campanha" }); continue; }
    // Meta sem detalhamento por dia: uma linha cobre vários dias; vai para o primeiro dia e avisamos
    if (mapa.fim != null && dataIso(val(l, "fim")) && dataIso(val(l, "fim")) !== data) avisoPeriodo = true;
    saida.push({
      plataforma, data,
      campanha_id: texto(val(l, "campanha_id"), 80) ?? campanha.slice(0, 80), campanha,
      grupo_id: texto(val(l, "grupo_id"), 80) ?? texto(val(l, "grupo"), 80) ?? "", grupo: texto(val(l, "grupo")),
      anuncio_id: texto(val(l, "anuncio_id"), 80) ?? texto(val(l, "anuncio"), 80) ?? "", anuncio: texto(val(l, "anuncio")),
      impressoes: Math.round(numero(val(l, "impressoes")) ?? 0), alcance: mapa.alcance != null ? Math.round(numero(val(l, "alcance")) ?? 0) : null,
      cliques: Math.round(numero(val(l, "cliques")) ?? 0), custo: numero(val(l, "custo")) ?? 0,
      conversoes_plataforma: numero(val(l, "conversoes")), valor_plataforma: numero(val(l, "valor")),
    });
  }
  const datas = saida.map((s) => s.data).sort();
  return {
    linhas: saida, erros, ignoradas, colunas: Object.keys(mapa),
    periodo: datas.length ? { de: datas[0], ate: datas.at(-1) } : null,
    avisos: avisoPeriodo ? ["O relatório não está dividido por dia: cada linha foi lançada no primeiro dia do período. Exporte com o detalhamento \"Dia\" para comparar períodos."] : [],
  };
}

export const importarGoogleAds = (csv) => importarMidia("google", csv, ALIAS_GOOGLE);
export const importarMetaAds = (csv) => importarMidia("meta", csv, ALIAS_META);

// ---- PMS / motor de reservas: relatório de reservas ----
// Os nomes das colunas variam entre sistemas (Silbeck, HSystem...). Sem nome, CPF ou contato do hóspede.

const ALIAS_PMS = {
  codigo: ["Código", "Codigo", "Reserva", "Nº reserva", "N reserva", "Número da reserva", "Localizador", "Código da reserva", "ID", "Id reserva", "Voucher"],
  data_reserva: ["Data da reserva", "Data reserva", "Criada em", "Data de criação", "Data criação", "Reservado em", "Data de emissão", "Emissão"],
  checkin: ["Check-in", "Checkin", "Entrada", "Chegada", "Data de entrada", "Data chegada", "Data de chegada"],
  checkout: ["Check-out", "Checkout", "Saída", "Partida", "Data de saída", "Data saída", "Data de partida"],
  noites: ["Noites", "Diárias", "Qtd diárias", "Nº diárias", "Pernoites"],
  categoria: ["Categoria", "Tipo de quarto", "Tipo UH", "Acomodação", "Tipo de apartamento", "Categoria UH", "Quarto"],
  valor_bruto: ["Valor bruto", "Valor total", "Total", "Valor", "Valor da reserva", "Total da reserva", "Diárias valor"],
  desconto: ["Desconto", "Descontos"],
  valor_liquido: ["Valor líquido", "Líquido", "Valor liquido", "Total líquido"],
  canal: ["Canal", "Origem", "Canal de venda", "Agência", "Agencia", "Segmento", "Fonte", "Meio"],
  campanha: ["Campanha", "Promoção", "Código promocional", "Cupom"],
  status: ["Status", "Situação", "Situacao", "Estado"],
  reembolso: ["Reembolso", "Valor reembolsado", "Estorno"],
};

export function statusReserva(v) {
  const s = normalizar(v);
  if (!s) return "confirmada";
  if (/cancel/.test(s)) return "cancelada";
  if (/no ?show|nao compareceu/.test(s)) return "no_show";
  if (/check ?out|finaliz|conclu|encerr|hospedagem realizada/.test(s)) return "concluida";
  if (/pendente|aguard|provis|orcamento|pre reserva/.test(s)) return "pendente";
  return "confirmada";
}

export function importarPms(csv, fonte = "pms") {
  const linhas = lerCsv(csv);
  const cab = acharCabecalho(linhas, ALIAS_PMS, ["codigo", "checkin"]);
  if (!cab) return { erro: `Não achei as colunas de código da reserva e data de entrada. Colunas encontradas: ${(linhas[0] ?? []).slice(0, 15).join(", ")}` };
  const { inicio, mapa } = cab;
  const val = (l, c) => (mapa[c] != null ? l[mapa[c]] : null);
  const saida = [], erros = [];
  let ignoradas = 0;
  for (let i = inicio + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (TOTAL_RE.test(l[0] ?? "")) { ignoradas++; continue; }
    const codigo = texto(val(l, "codigo"), 80);
    const checkin = dataIso(val(l, "checkin"));
    if (!codigo || !checkin) { erros.push({ linha: i + 1, erro: !codigo ? "sem código" : `entrada inválida: "${val(l, "checkin") ?? ""}"` }); continue; }
    const checkout = dataIso(val(l, "checkout"));
    const noites = numero(val(l, "noites")) ?? (checkout ? Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000) : null);
    const bruto = numero(val(l, "valor_bruto"));
    const desconto = numero(val(l, "desconto"));
    saida.push({
      fonte, codigo, checkin, checkout, noites,
      data_reserva: dataIso(val(l, "data_reserva")),
      categoria: texto(val(l, "categoria")), canal: texto(val(l, "canal")), campanha: texto(val(l, "campanha")),
      valor_bruto: bruto, desconto, valor_liquido: numero(val(l, "valor_liquido")),
      status: statusReserva(val(l, "status")), reembolso: numero(val(l, "reembolso")),
    });
  }
  const datas = saida.map((s) => s.data_reserva ?? s.checkin).sort();
  const avisos = [];
  if (mapa.data_reserva == null) avisos.push("O relatório não tem a data em que a reserva foi feita; usei a data de entrada para os períodos.");
  if (mapa.canal == null) avisos.push("O relatório não tem a coluna de canal: não dá para separar OTAs de reservas diretas.");
  if (mapa.valor_bruto == null && mapa.valor_liquido == null) avisos.push("O relatório não tem valores: a receita dessas reservas fica zerada.");
  return { linhas: saida, erros, ignoradas, colunas: Object.keys(mapa), periodo: datas.length ? { de: datas[0], ate: datas.at(-1) } : null, avisos };
}
