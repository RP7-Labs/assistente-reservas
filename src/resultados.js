// Motor de resultados: junta gasto das campanhas, origem das conversas, reservas do sistema e do PMS
// e responde quanto cada canal e campanha investiu, vendeu e deixou de margem.
// Regras: uma reserva conta uma vez só (mesmo que Google e Meta digam que é delas); reserva cancelada
// não é receita; sem origem confiável a reserva fica "origem desconhecida", nunca numa campanha inventada.
import { fonte } from "./rastreio.js";
import { normalizar } from "./importacao.js";

export const CANAIS = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  organico: "Orgânico e indicações",
  direto: "Direto (site, WhatsApp)",
  ota: "OTAs (Booking, Expedia...)",
  desconhecido: "Origem desconhecida",
};

// ---- Configuração padrão (editável no painel; tudo identificado como estimativa ou meta) ----

export const CONFIG_PADRAO = {
  financeiro: {
    comissao_ota_pct: 15,          // comissão média das OTAs sobre o valor da reserva (estimativa)
    taxa_pagamento_pct: 3,         // cartão/Pix nas reservas diretas (estimativa)
    impostos_pct: 6,               // impostos sobre a receita (estimativa; confirmar com a contabilidade)
    custo_variavel_noite: 40,      // limpeza, lavanderia, amenities, energia por noite ocupada (estimativa)
    pms_valor_ja_liquido_de_comissao: false, // se o PMS já desconta a comissão da OTA, não descontar de novo
    retorno_minimo_pct: 30,        // quanto da margem de contribuição precisa sobrar depois da mídia
  },
  metas: {
    meses_alta: [12, 1, 2, 3],
    baixa: { custo_operacional_max: 40000, receita_min: 60000, receita_max: 70000 },
    alta: { custo_operacional_max: null, receita_min: null, receita_max: null },
    midia_mensal: 1500,
    ocupacao_pct: null,
    diaria_media: null,
    unidades: 29,
  },
  ferramentas: {
    limite_mensal: 500,
    itens: [
      { nome: "Vercel (Hobby)", categoria: "Infraestrutura", mensal: 0, obs: "Plano gratuito atual; Pro custa US$ 20/mês se precisar" },
      { nome: "Supabase (Free)", categoria: "Infraestrutura", mensal: 0, obs: "Plano gratuito atual; Pro custa US$ 25/mês" },
      { nome: "Resend (e-mail)", categoria: "Serviços externos", mensal: 0, obs: "Gratuito até 3.000 e-mails/mês" },
      { nome: "Google Ads API e Meta Marketing API", categoria: "Conectores de dados", mensal: 0, obs: "APIs oficiais gratuitas; exigem aprovação de acesso" },
      { nome: "Google Analytics 4 e Tag Manager", categoria: "Conectores de dados", mensal: 0, obs: "Gratuitos" },
      { nome: "WhatsApp Cloud API", categoria: "Serviços externos", mensal: 0, obs: "Respostas ao cliente grátis; mensagens de marketing são cobradas por envio" },
    ],
  },
};

export function configCompleta(salvas = {}) {
  const c = structuredClone(CONFIG_PADRAO);
  for (const k of Object.keys(c)) if (salvas[k] && typeof salvas[k] === "object") c[k] = { ...c[k], ...salvas[k] };
  return c;
}

// ---- Canal de uma conversa (pela origem rastreada) ou de uma reserva do PMS (pela coluna canal) ----

const PAGO_RE = /^(cpc|ppc|paid|paid_social|paidsocial|pago|ads|display|whatsapp_ads|cpm)/;
export function canalDaOrigem(o) {
  if (!o) return { canal: "desconhecido", campanha: null };
  const src = (o.utm_source ?? "").toLowerCase(), med = (o.utm_medium ?? "").toLowerCase();
  const campanha = o.utm_campaign ?? null;
  const pago = PAGO_RE.test(med) || o.gclid || o.gbraid || o.wbraid || o.fbclid || o.ctwa_clid || o.meta_lead_id;
  if (o.gclid || o.gbraid || o.wbraid || (pago && /google|adwords/.test(src))) return { canal: "google_ads", campanha };
  if (o.ctwa_clid || o.meta_lead_id || o.fbclid || (pago && /meta|facebook|instagram|^fb|^ig/.test(src))) return { canal: "meta_ads", campanha };
  if (src === "site" || (!src && !o.referrer)) return { canal: "direto", campanha: null };
  return { canal: "organico", campanha: campanha ?? (src || fonte(o)) };
}

const OTA_RE = /booking|expedia|decolar|airbnb|hoteis ?com|hotels ?com|agoda|trivago|123 ?milhas|hurb|cvc|trip ?advisor|despegar|omnibees|ota/;
const DIRETO_RE = /site|motor|hbook|direto|whats|telefone|balcao|walk|recep|email|e mail|instagram|facebook|particular|proprio/;
export function canalDoPms(texto) {
  const t = normalizar(texto);
  if (OTA_RE.test(t)) return "ota";
  if (DIRETO_RE.test(t)) return "direto";
  return "desconhecido";
}

const noitesEntre = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)) : 0);
const ATIVA = (s) => !["cancelada", "no_show", "pendente"].includes(s);

// ---- Junta reservas do sistema e do PMS numa lista só, sem duplicar ----

export function unificarReservas({ reservas = [], leads = [], origens = [], externas = [] }) {
  const leadDe = new Map(leads.map((l) => [l.id, l]));
  const origemDe = new Map(origens.map((o) => [o.conversa_id, o]));
  const doSistema = reservas.map((r) => {
    const lead = r.lead_id ? leadDe.get(r.lead_id) : null;
    const o = lead ? origemDe.get(lead.conversa_id) : null;
    const { canal, campanha } = lead ? canalDaOrigem(o) : { canal: "direto", campanha: null };
    return {
      codigo: r.codigo_motor, fonte: "sistema", data: String(r.criado_em ?? r.checkin).slice(0, 10), checkin: r.checkin, checkout: r.checkout,
      noites: noitesEntre(r.checkin, r.checkout), categoria: r.quarto_id, valor: Number(r.valor ?? 0), status: r.status,
      canal: lead ? canal : "direto", campanha, conversa_id: lead?.conversa_id ?? null,
      atribuicao: lead ? (o ? "rastreada" : "sem_origem") : "lancada_a_mao",
    };
  });

  const porCodigo = new Map(doSistema.map((r) => [normalizar(r.codigo), r]));
  const usadas = new Set();
  const lista = [];
  const conciliacao = { por_codigo: 0, por_datas_valor: 0, so_pms: 0, so_sistema: 0 };
  for (const e of externas) {
    const valor = Number(e.valor_liquido ?? ((e.valor_bruto ?? 0) - (e.desconto ?? 0)));
    const base = {
      codigo: e.codigo, fonte: "pms", data: e.data_reserva ?? e.checkin, checkin: e.checkin, checkout: e.checkout,
      noites: e.noites ?? noitesEntre(e.checkin, e.checkout), categoria: e.categoria, valor: valor - Number(e.reembolso ?? 0), status: e.status,
      canal_pms: e.canal, canal: canalDoPms(e.canal), campanha: e.campanha ?? null, atribuicao: "canal_pms",
    };
    // 1) mesmo código; 2) mesmas datas e valor (uma única candidata)
    let s = porCodigo.get(normalizar(e.codigo));
    let como = s ? "por_codigo" : null;
    if (!s && base.canal !== "ota") {
      const cands = doSistema.filter((r) => !usadas.has(r.codigo) && r.checkin === e.checkin && r.checkout === e.checkout && Math.abs(r.valor - valor) <= 1);
      if (cands.length === 1) { s = cands[0]; como = "por_datas_valor"; }
    }
    if (s && !usadas.has(s.codigo)) {
      usadas.add(s.codigo);
      conciliacao[como]++;
      // O PMS manda no valor e no status; o sistema manda na origem
      lista.push({ ...base, fonte: "ambos", codigo_sistema: s.codigo, canal: s.canal === "direto" && base.canal !== "direto" ? base.canal : s.canal,
        campanha: s.campanha ?? base.campanha, conversa_id: s.conversa_id, atribuicao: s.atribuicao, conciliada: como });
    } else {
      conciliacao.so_pms++;
      lista.push(base);
    }
  }
  // Só cobra conciliação das reservas feitas dentro do período que o relatório do PMS cobre
  const datasPms = externas.map((e) => e.data_reserva ?? e.checkin).filter(Boolean).sort();
  const cobre = (r) => datasPms.length && r.data >= datasPms[0] && r.data <= datasPms.at(-1);
  for (const r of doSistema) {
    if (usadas.has(r.codigo)) continue;
    const falta = Boolean(cobre(r) && ATIVA(r.status));
    if (falta) conciliacao.so_sistema++;
    lista.push({ ...r, nao_conciliada: falta });
  }
  return { reservas: lista, conciliacao };
}

// ---- Valores de uma reserva: receita líquida e margem de contribuição ----

export function valoresReserva(r, fin) {
  if (!ATIVA(r.status)) return { bruta: 0, liquida: 0, contribuicao: 0 };
  const bruta = Number(r.valor ?? 0);
  const comissao = r.canal === "ota" && !(r.fonte !== "sistema" && fin.pms_valor_ja_liquido_de_comissao) ? bruta * fin.comissao_ota_pct / 100 : 0;
  const taxa = r.canal === "ota" ? 0 : bruta * fin.taxa_pagamento_pct / 100;
  const impostos = bruta * fin.impostos_pct / 100;
  const liquida = bruta - comissao - taxa - impostos;
  return { bruta, liquida, contribuicao: liquida - fin.custo_variavel_noite * (r.noites ?? 0) };
}

const somar = (xs, f) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const razao = (a, b) => (b ? a / b : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// Liga a campanha da origem (utm_campaign) ao gasto: pelo id da campanha ou pelo nome
const chaveCampanha = (v) => normalizar(v).replace(/\s+/g, "-");

// ---- Resumo de um período ----

export function resumir({ de, ate, reservas, midia = [], conversas = [], origens = [], visitas = [], config }) {
  const fin = config.financeiro;
  const noPeriodo = reservas.filter((r) => r.data >= de && r.data <= ate);
  const origemDe = new Map(origens.map((o) => [o.conversa_id, o]));
  const linhaVazia = (extra) => ({ ...extra, investimento: 0, impressoes: 0, cliques: 0, conv_plataforma: 0, valor_plataforma: 0, visitantes: 0, conversas: 0, reservas: 0, canceladas: 0, noites: 0, receita_bruta: 0, receita_liquida: 0, contribuicao: 0 });

  const canais = Object.fromEntries(Object.keys(CANAIS).map((c) => [c, linhaVazia({ canal: c, nome: CANAIS[c] })]));
  const campanhas = new Map();
  const campanhaDe = (plataforma, id, nome) => {
    const k = `${plataforma}|${chaveCampanha(id)}`;
    if (!campanhas.has(k)) campanhas.set(k, linhaVazia({ canal: plataforma, campanha_id: id, campanha: nome ?? id, dias: new Set() }));
    const c = campanhas.get(k);
    if (nome && c.campanha === c.campanha_id) c.campanha = nome;
    return c;
  };
  // Nome → id das campanhas, para achar o gasto quando a UTM traz o nome
  const idPorNome = new Map();

  for (const m of midia.filter((m) => m.data >= de && m.data <= ate)) {
    const canal = m.plataforma === "google" ? "google_ads" : "meta_ads";
    const alvo = [canais[canal], campanhaDe(canal, m.campanha_id, m.campanha)];
    idPorNome.set(`${canal}|${chaveCampanha(m.campanha)}`, chaveCampanha(m.campanha_id));
    alvo[1].dias.add(m.data);
    for (const a of alvo) {
      a.investimento += Number(m.custo ?? 0); a.impressoes += Number(m.impressoes ?? 0); a.cliques += Number(m.cliques ?? 0);
      a.conv_plataforma += Number(m.conversoes_plataforma ?? 0); a.valor_plataforma += Number(m.valor_plataforma ?? 0);
    }
  }
  const campanhaDaReserva = (canal, campanha) => {
    if (!campanha || !["google_ads", "meta_ads"].includes(canal)) return null;
    const id = idPorNome.get(`${canal}|${chaveCampanha(campanha)}`) ?? chaveCampanha(campanha);
    const k = `${canal}|${id}`;
    return campanhas.get(k) ?? campanhaDe(canal, campanha, campanha);
  };

  for (const c of conversas.filter((c) => String(c.criado_em ?? c.atualizado_em ?? "").slice(0, 10) >= de && String(c.criado_em ?? c.atualizado_em ?? "").slice(0, 10) <= ate)) {
    const { canal, campanha } = canalDaOrigem(origemDe.get(c.id));
    canais[canal].conversas++;
    const camp = campanhaDaReserva(canal, campanha);
    if (camp) camp.conversas++;
  }
  const vistos = new Set();
  for (const v of visitas.filter((v) => v.criado_em.slice(0, 10) >= de && v.criado_em.slice(0, 10) <= ate)) {
    const { canal } = canalDaOrigem(v.utm_source || v.referrer ? v : null);
    if (vistos.has(`${v.visitante}|${canal}`)) continue;
    vistos.add(`${v.visitante}|${canal}`);
    canais[canal].visitantes++;
  }

  const detalhe = [];
  for (const r of noPeriodo) {
    const v = valoresReserva(r, fin);
    const alvos = [canais[r.canal] ?? canais.desconhecido, campanhaDaReserva(r.canal, r.campanha)].filter(Boolean);
    for (const a of alvos) {
      if (ATIVA(r.status)) { a.reservas++; a.noites += r.noites ?? 0; } else if (r.status !== "pendente") a.canceladas++;
      a.receita_bruta += v.bruta; a.receita_liquida += v.liquida; a.contribuicao += v.contribuicao;
    }
    detalhe.push({ ...r, ...v, canal_nome: CANAIS[r.canal] });
  }

  const fechar = (l) => {
    const { dias, ...x } = l;
    return {
      ...x, dias_com_gasto: dias?.size,
      investimento: r2(x.investimento), receita_bruta: r2(x.receita_bruta), receita_liquida: r2(x.receita_liquida),
      margem: r2(x.contribuicao - x.investimento), contribuicao: r2(x.contribuicao),
      roas: r2(razao(x.receita_bruta, x.investimento)), custo_por_reserva: r2(x.reservas && x.investimento ? x.investimento / x.reservas : null),
      ctr: r2(x.impressoes ? (x.cliques / x.impressoes) * 100 : null), cpc: r2(razao(x.investimento, x.cliques)),
      conversao_conversas: r2(x.conversas ? (x.reservas / x.conversas) * 100 : null),
      taxa_cancelamento: r2(x.reservas + x.canceladas ? (x.canceladas / (x.reservas + x.canceladas)) * 100 : null),
      receita_media: r2(razao(x.receita_bruta, x.reservas)),
    };
  };
  const listaCanais = Object.values(canais).map(fechar);
  const listaCampanhas = [...campanhas.values()].map(fechar).sort((a, b) => b.investimento - a.investimento || b.receita_bruta - a.receita_bruta);

  const ativas = noPeriodo.filter((r) => ATIVA(r.status));
  const investimento = somar(listaCanais, (c) => c.investimento);
  const pagos = listaCanais.filter((c) => ["google_ads", "meta_ads"].includes(c.canal));
  const receitaPaga = somar(pagos, (c) => c.receita_bruta), reservasPagas = somar(pagos, (c) => c.reservas);
  const receita = somar(listaCanais, (c) => c.receita_bruta);
  const diretas = ativas.filter((r) => r.canal !== "ota").length;
  const contribDiretas = somar(detalhe.filter((r) => ATIVA(r.status) && r.canal !== "ota"), (r) => r.contribuicao);

  const kpis = {
    investimento: r2(investimento),
    reservas: ativas.length,
    reservas_campanhas: reservasPagas,
    receita_bruta: r2(receita),
    receita_liquida: r2(somar(listaCanais, (c) => c.receita_liquida)),
    receita_campanhas: r2(receitaPaga),
    roas: r2(razao(receitaPaga, investimento)),
    custo_por_reserva: r2(reservasPagas ? investimento / reservasPagas : null),
    receita_media: r2(razao(receita, ativas.length)),
    noites: somar(ativas, (r) => r.noites),
    canceladas: noPeriodo.filter((r) => ["cancelada", "no_show"].includes(r.status)).length,
    participacao_direta: r2(ativas.length ? (diretas / ativas.length) * 100 : null),
    conversas: somar(listaCanais, (c) => c.conversas),
    conversao_conversas: r2(somar(listaCanais, (c) => c.conversas) ? (somar(listaCanais, (c) => c.reservas) / somar(listaCanais, (c) => c.conversas)) * 100 : null),
    // Quanto dá para pagar por reserva e ainda sobrar o retorno mínimo
    custo_maximo_reserva: r2(diretas ? (contribDiretas / diretas) * (1 - fin.retorno_minimo_pct / 100) : null),
    // O que Google e Meta dizem, separado: nunca somar com as reservas confirmadas
    conv_google: r2(canais.google_ads.conv_plataforma), conv_meta: r2(canais.meta_ads.conv_plataforma),
  };
  return { de, ate, kpis, canais: listaCanais, campanhas: listaCampanhas, reservas: detalhe };
}

// ---- Período anterior de mesmo tamanho, para comparar ----
export function periodoAnterior(de, ate) {
  const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
  const fim = new Date(Date.parse(de) - 86_400_000);
  const ini = new Date(fim.getTime() - (dias - 1) * 86_400_000);
  return { de: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10), dias };
}

export function variacoes(atual, anterior) {
  const v = {};
  for (const [k, x] of Object.entries(atual)) {
    const y = anterior[k];
    if (typeof x !== "number" || typeof y !== "number") continue;
    v[k] = { anterior: y, diferenca: r2(x - y), pct: y ? r2(((x - y) / Math.abs(y)) * 100) : null };
  }
  return v;
}

// ---- Qualidade e cobertura dos dados ----
export function qualidade({ resumo, conciliacao, importacoes = [], midia = [], hoje }) {
  const ativas = resumo.reservas.filter((r) => ATIVA(r.status));
  const desconhecidas = ativas.filter((r) => r.canal === "desconhecido" || r.atribuicao === "sem_origem").length;
  const ultima = (tipo) => importacoes.find((i) => i.tipo === tipo)?.criado_em ?? null;
  const ultimoDia = (p) => midia.filter((m) => m.plataforma === p).map((m) => m.data).sort().at(-1) ?? null;
  const atraso = (d) => (d ? Math.round((Date.parse(hoje) - Date.parse(d)) / 86_400_000) : null);
  return {
    reservas: ativas.length,
    com_origem: ativas.length - desconhecidas,
    origem_desconhecida: desconhecidas,
    cobertura_pct: r2(ativas.length ? ((ativas.length - desconhecidas) / ativas.length) * 100 : null),
    conciliacao,
    fontes: [
      { fonte: "google", nome: "Google Ads", ultima_importacao: ultima("google"), dados_ate: ultimoDia("google"), dias_atraso: atraso(ultimoDia("google")) },
      { fonte: "meta", nome: "Meta Ads", ultima_importacao: ultima("meta"), dados_ate: ultimoDia("meta"), dias_atraso: atraso(ultimoDia("meta")) },
      { fonte: "pms", nome: "PMS / motor de reservas", ultima_importacao: ultima("pms"), dados_ate: null, dias_atraso: atraso(ultima("pms")?.slice(0, 10)) },
    ],
  };
}

// ---- Alertas de desperdício e falhas, com amostra mínima e nível de confiança ----

const fmt = (v) => `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function alertas({ resumo, anterior, qualidade: q, config }) {
  const lista = [];
  const dias = Math.round((Date.parse(resumo.ate) - Date.parse(resumo.de)) / 86_400_000) + 1;
  const teto = resumo.kpis.custo_maximo_reserva;
  const add = (a) => lista.push(a);

  for (const c of resumo.campanhas) {
    if (!["google_ads", "meta_ads"].includes(c.canal) || !c.investimento) continue;
    const plataforma = c.canal === "google_ads" ? "Google Ads" : "Meta Ads";
    if (c.reservas === 0) {
      // Abaixo de 7 dias ou R$ 100 não há amostra para dizer nada
      if (dias < 7 || c.investimento < 100) continue;
      // Zero reservas só vira alerta forte com tempo e gasto suficientes
      const gastoAlto = teto ? c.investimento >= 2 * teto : c.investimento >= 500;
      const confianca = dias >= 21 && gastoAlto ? "alta" : dias >= 14 && (teto ? c.investimento >= teto : c.investimento >= 250) ? "média" : "baixa";
      add({
        tipo: "sem_reserva", prioridade: confianca === "alta" ? "alta" : confianca === "média" ? "média" : "baixa", confianca,
        titulo: `${plataforma} · "${c.campanha}" gastou ${fmt(c.investimento)} sem reserva confirmada`,
        dados: { investimento: c.investimento, cliques: c.cliques, conversas: c.conversas, conv_plataforma: c.conv_plataforma, dias },
        impacto: `Até ${fmt(c.investimento)} no período sem retorno confirmado (estimativa).`,
        acao: confianca === "baixa"
          ? "Ainda é cedo para concluir: acompanhe por mais 1 a 2 semanas e confira se a campanha leva UTM no link."
          : c.conversas === 0 && c.cliques > 30
            ? "Os cliques não viram conversa: revise a página de destino e confira se o link tem as UTMs; depois reduza a verba se continuar sem conversas."
            : "Reduza a verba gradualmente (20 a 30%) e revise público, termos e anúncios. Reavalie em 14 dias.",
        criterio: "Voltar a ter reservas confirmadas com custo por reserva abaixo do teto.",
      });
    } else if (teto && c.custo_por_reserva > teto && c.reservas >= 2) {
      add({
        tipo: "custo_alto", prioridade: c.reservas >= 4 ? "alta" : "média", confianca: c.reservas >= 4 ? "alta" : "média",
        titulo: `${plataforma} · "${c.campanha}": custo por reserva de ${fmt(c.custo_por_reserva)}, acima do teto de ${fmt(teto)}`,
        dados: { custo_por_reserva: c.custo_por_reserva, teto, reservas: c.reservas, investimento: c.investimento, roas: c.roas },
        impacto: `Cerca de ${fmt((c.custo_por_reserva - teto) * c.reservas)} acima do que a margem comporta no período (estimativa).`,
        acao: "Reduza lances ou verba e concentre o orçamento nos grupos/anúncios com reserva. Não aumente esta campanha agora.",
        criterio: "Custo por reserva abaixo do teto nas próximas 2 semanas.",
      });
    }
    // Gasta mais do que traz de receita, com dados suficientes
    if (c.reservas >= 1 && c.roas != null && c.roas < 1 && (teto ? c.investimento >= teto : c.investimento >= 300)) {
      add({
        tipo: "roas_baixo", prioridade: c.reservas >= 3 ? "alta" : "média", confianca: c.reservas >= 3 ? "alta" : "baixa",
        titulo: `${plataforma} · "${c.campanha}" trouxe ${fmt(c.receita_bruta)} de receita para ${fmt(c.investimento)} investidos (ROAS ${c.roas})`,
        dados: { roas: c.roas, investimento: c.investimento, receita: c.receita_bruta, reservas: c.reservas },
        impacto: `Prejuízo de mídia de cerca de ${fmt(c.investimento - c.receita_bruta)} no período, antes dos custos da hospedagem (estimativa).`,
        acao: c.reservas >= 3 ? "Reduza a verba desta campanha e realoque nas campanhas com ROAS acima de 3." : "Poucas reservas para concluir: acompanhe mais 2 semanas antes de cortar.",
        criterio: "ROAS acima de 3 ou campanha pausada.",
      });
    }
    // Plataforma diz que converteu, mas nada confirmado: rastreio ou critério de conversão errado
    if (c.conv_plataforma >= 3 && c.conv_plataforma > 3 * Math.max(c.reservas, 1)) {
      add({
        tipo: "conversao_inconsistente", prioridade: "média", confianca: "média",
        titulo: `${plataforma} · "${c.campanha}" registra ${c.conv_plataforma} conversões, mas só ${c.reservas} reservas confirmadas`,
        dados: { conv_plataforma: c.conv_plataforma, reservas: c.reservas },
        impacto: "A plataforma otimiza para um evento que não é reserva paga e pode gastar com o público errado.",
        acao: "Confira qual ação conta como conversão (clique no WhatsApp ou formulário não é reserva). Use a conversão de compra enviada pelo sistema como principal.",
        criterio: "Conversões da plataforma próximas das reservas confirmadas.",
      });
    }
    if (c.cliques >= 100 && c.conversas === 0 && c.reservas === 0) {
      add({
        tipo: "rastreio", prioridade: "média", confianca: "média",
        titulo: `${plataforma} · "${c.campanha}": ${c.cliques} cliques e nenhuma conversa registrada`,
        dados: { cliques: c.cliques, conversas: 0 },
        impacto: "Sem saber se os cliques viram contato, não dá para avaliar a campanha.",
        acao: "Coloque as UTMs no link do anúncio (utm_campaign com o id da campanha) e confira se o site leva para o chat ou WhatsApp com o código de origem.",
        criterio: "Conversas aparecendo com a origem desta campanha.",
      });
    }
  }

  // Queda do ROAS em relação ao período anterior
  if (anterior && resumo.kpis.roas != null && anterior.kpis.roas && resumo.kpis.investimento >= 300 && resumo.kpis.roas < anterior.kpis.roas * 0.7) {
    add({
      tipo: "roas_caiu", prioridade: "média", confianca: resumo.kpis.reservas_campanhas >= 5 ? "média" : "baixa",
      titulo: `ROAS das campanhas caiu de ${anterior.kpis.roas} para ${resumo.kpis.roas}`,
      dados: { roas_atual: resumo.kpis.roas, roas_anterior: anterior.kpis.roas },
      impacto: "Cada real investido está trazendo menos receita que no período anterior.",
      acao: "Veja quais campanhas pioraram na tabela e se a queda é da temporada (baixa) antes de cortar verba.",
      criterio: "ROAS voltando ao nível anterior.",
    });
  }
  // Cancelamentos
  const k = resumo.kpis;
  if (k.reservas + k.canceladas >= 5 && k.canceladas / (k.reservas + k.canceladas) > 0.2) {
    add({
      tipo: "cancelamentos", prioridade: "média", confianca: "média",
      titulo: `${k.canceladas} cancelamentos ou no-shows (${Math.round((k.canceladas / (k.reservas + k.canceladas)) * 100)}% das reservas)`,
      dados: { canceladas: k.canceladas, reservas: k.reservas },
      impacto: "Reserva cancelada não é receita, mas a mídia já foi paga.",
      acao: "Veja de quais canais vêm os cancelamentos e revise a política (pré-autorização, tarifa não reembolsável).",
      criterio: "Taxa de cancelamento abaixo de 15%.",
    });
  }
  // Dados desatualizados ou faltando
  for (const f of q.fontes) {
    if (f.fonte !== "pms" && resumo.canais.find((c) => c.canal === (f.fonte === "google" ? "google_ads" : "meta_ads"))?.investimento === 0 && !f.ultima_importacao) continue;
    if (f.dias_atraso != null && f.dias_atraso > 7) {
      add({
        tipo: "dados_atrasados", prioridade: "baixa", confianca: "alta",
        titulo: `${f.nome}: dados com ${f.dias_atraso} dias de atraso`,
        dados: { ultima_importacao: f.ultima_importacao, dados_ate: f.dados_ate },
        impacto: "As análises do período recente ficam incompletas.",
        acao: `Importe o relatório mais recente do ${f.nome}.`,
        criterio: "Dados até ontem.",
      });
    }
  }
  if (!q.fontes.find((f) => f.fonte === "pms").ultima_importacao) {
    add({
      tipo: "sem_pms", prioridade: "alta", confianca: "alta",
      titulo: "Ainda não há reservas do PMS: só as reservas feitas pelo assistente estão no painel",
      dados: {}, impacto: "Sem o PMS, OTAs e reservas do motor ficam de fora e o ROAS real não pode ser conciliado.",
      acao: "Exporte do PMS (ou do motor) o relatório de reservas do período em CSV e importe na área Importações.",
      criterio: "Reservas do PMS importadas e conciliadas.",
    });
  }
  if (q.conciliacao.so_sistema > 0) {
    add({
      tipo: "nao_conciliada", prioridade: "média", confianca: "média",
      titulo: `${q.conciliacao.so_sistema} reserva(s) do assistente não aparecem no PMS`,
      dados: q.conciliacao,
      impacto: "Reserva paga fora do PMS pode gerar overbooking ou receita que não entra no caixa.",
      acao: "Confira se essas reservas foram lançadas no PMS; anote o código do sistema no campo de observação do PMS para conciliar.",
      criterio: "Todas as reservas do assistente encontradas no PMS.",
    });
  }
  const ordem = { alta: 0, média: 1, baixa: 2 };
  return lista.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade]);
}

// ---- Recomendações: o que fazer com a verba, sempre como sugestão (nada muda sozinho) ----

export function recomendacoes({ resumo, alertas: als, config, ocupacao }) {
  const recs = [];
  const teto = resumo.kpis.custo_maximo_reserva;
  const semVaga = ocupacao?.pct != null && ocupacao.pct >= 90;
  for (const c of resumo.campanhas) {
    if (!["google_ads", "meta_ads"].includes(c.canal) || !c.investimento) continue;
    if (c.reservas >= 3 && teto && c.custo_por_reserva <= teto * 0.7 && c.margem > 0) {
      recs.push({
        prioridade: "alta", confianca: c.reservas >= 6 ? "alta" : "média",
        titulo: semVaga ? `Manter "${c.campanha}" (ocupação alta)` : `Aumentar gradualmente "${c.campanha}"`,
        justificativa: `Custo por reserva de R$ ${c.custo_por_reserva} contra teto de R$ ${teto}, com ${c.reservas} reservas e margem positiva depois da mídia.`,
        indicadores: { reservas: c.reservas, custo_por_reserva: c.custo_por_reserva, roas: c.roas, margem: c.margem },
        impacto: semVaga ? "Ocupação acima de 90%: mais verba não vira mais reservas." : `Estimativa: +15% de verba (R$ ${r2(c.investimento * 0.15)}) pode trazer cerca de ${Math.max(1, Math.round(c.reservas * 0.1))} reserva(s) a mais, se o custo se mantiver. Não é garantido.`,
        acao: semVaga ? "Não aumentar; use a verba nas datas com mais vagas." : "Aumente 15% e reavalie em 14 dias. Pare de aumentar se o custo por reserva subir acima do teto.",
        criterio: "Custo por reserva continua abaixo do teto depois do aumento.",
      });
    }
  }
  for (const a of als.filter((a) => ["sem_reserva", "custo_alto"].includes(a.tipo) && a.confianca !== "baixa")) {
    recs.push({ prioridade: a.prioridade, confianca: a.confianca, titulo: a.tipo === "sem_reserva" ? "Reduzir verba de campanha sem reservas" : "Reduzir custo por reserva", justificativa: a.titulo, indicadores: a.dados, impacto: a.impacto, acao: a.acao, criterio: a.criterio });
  }
  const k = resumo.kpis;
  const ota = resumo.canais.find((c) => c.canal === "ota");
  if (ota?.reservas && k.reservas && ota.reservas / k.reservas > 0.5) {
    const comissao = r2(ota.receita_bruta * config.financeiro.comissao_ota_pct / 100);
    recs.push({
      prioridade: "média", confianca: "média",
      titulo: "Trazer parte das reservas das OTAs para o canal direto",
      justificativa: `${Math.round((ota.reservas / k.reservas) * 100)}% das reservas vieram de OTAs, com cerca de R$ ${comissao} em comissões no período (estimativa).`,
      indicadores: { reservas_ota: ota.reservas, comissao_estimada: comissao },
      impacto: `Cada 10% dessas reservas feitas direto economiza cerca de R$ ${r2(comissao * 0.1)} em comissão (estimativa).`,
      acao: "Ofereça vantagem para reservar direto (café, late checkout) no guia da estadia e no WhatsApp para hóspedes que voltam; use remarketing para quem visitou o site.",
      criterio: "Participação direta subindo mês a mês.",
    });
  }
  if (k.investimento > 0 && k.conversas && k.conversao_conversas != null && k.conversao_conversas < 5 && k.conversas >= 30) {
    recs.push({
      prioridade: "alta", confianca: "média",
      titulo: "Melhorar o atendimento: muitas conversas e poucas reservas",
      justificativa: `${k.conversas} conversas e só ${k.conversao_conversas}% viraram reserva.`,
      indicadores: { conversas: k.conversas, conversao: k.conversao_conversas },
      impacto: "Subir a conversão para 10% dobra as reservas sem gastar mais em mídia (estimativa).",
      acao: "Revise as conversas sem reserva na aba Atendimentos: preço, demora ou falta de vaga? Ajuste as respostas do assistente e o follow-up.",
      criterio: "Conversão de conversas acima de 10%.",
    });
  }
  return recs;
}

// ---- Sazonalidade: receita por mês de hospedagem contra as metas ----
export function sazonalidade({ reservas, midia = [], config, ano }) {
  const fin = config.financeiro, metas = config.metas;
  const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, temporada: metas.meses_alta.includes(i + 1) ? "alta" : "baixa", reservas: 0, noites: 0, receita_bruta: 0, contribuicao: 0, investimento: 0 }));
  for (const r of reservas) {
    if (!r.checkin?.startsWith(String(ano)) || !ATIVA(r.status)) continue;
    const m = meses[Number(r.checkin.slice(5, 7)) - 1];
    const v = valoresReserva(r, fin);
    m.reservas++; m.noites += r.noites ?? 0; m.receita_bruta += v.bruta; m.contribuicao += v.contribuicao;
  }
  for (const x of midia) if (x.data.startsWith(String(ano))) meses[Number(x.data.slice(5, 7)) - 1].investimento += Number(x.custo ?? 0);
  return meses.map((m) => {
    const meta = metas[m.temporada] ?? {};
    const diasMes = new Date(ano, m.mes, 0).getDate();
    return {
      ...m, receita_bruta: r2(m.receita_bruta), contribuicao: r2(m.contribuicao), investimento: r2(m.investimento),
      ocupacao_pct: metas.unidades ? r2((m.noites / (metas.unidades * diasMes)) * 100) : null,
      diaria_media: r2(razao(m.receita_bruta, m.noites)),
      meta_receita_min: meta.receita_min ?? null, meta_receita_max: meta.receita_max ?? null, custo_operacional_max: meta.custo_operacional_max ?? null,
    };
  });
}

// ---- Relatório em CSV (para a reunião com a agência) ----
export function csvRelatorio({ resumo, alertas: als, qualidade: q }) {
  const c = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = (v) => (v == null ? "" : String(v).replace(".", ","));
  const linhas = [];
  linhas.push(`Relatório de resultados;${resumo.de} a ${resumo.ate}`);
  linhas.push("");
  linhas.push("Indicador;Valor");
  const k = resumo.kpis;
  for (const [n, v] of [["Investimento em mídia", k.investimento], ["Reservas confirmadas (todas)", k.reservas], ["Reservas atribuídas a campanhas", k.reservas_campanhas], ["Receita bruta (todas)", k.receita_bruta], ["Receita das campanhas", k.receita_campanhas], ["ROAS das campanhas", k.roas], ["Custo por reserva (campanhas)", k.custo_por_reserva], ["Teto de custo por reserva", k.custo_maximo_reserva], ["Cancelamentos e no-shows", k.canceladas], ["Participação direta (%)", k.participacao_direta], ["Conversões informadas pelo Google (não somar)", k.conv_google], ["Conversões informadas pela Meta (não somar)", k.conv_meta], ["Reservas com origem conhecida (%)", q.cobertura_pct]]) linhas.push(`${c(n)};${num(v)}`);
  linhas.push("");
  linhas.push("Canal;Investimento;Visitantes;Conversas;Reservas;Canceladas;Receita bruta;Receita líquida;ROAS;Custo por reserva;Margem após mídia");
  for (const x of resumo.canais) linhas.push([x.nome, x.investimento, x.visitantes, x.conversas, x.reservas, x.canceladas, x.receita_bruta, x.receita_liquida, x.roas, x.custo_por_reserva, x.margem].map((v, i) => (i ? num(v) : c(v))).join(";"));
  linhas.push("");
  linhas.push("Plataforma;Campanha;Investimento;Impressões;Cliques;Conversões da plataforma;Conversas;Reservas;Receita bruta;ROAS;Custo por reserva;Margem após mídia");
  for (const x of resumo.campanhas) linhas.push([CANAIS[x.canal], x.campanha, x.investimento, x.impressoes, x.cliques, x.conv_plataforma, x.conversas, x.reservas, x.receita_bruta, x.roas, x.custo_por_reserva, x.margem].map((v, i) => (i > 1 ? num(v) : c(v))).join(";"));
  linhas.push("");
  linhas.push("Prioridade;Confiança;Alerta;Ação recomendada");
  for (const a of als) linhas.push([a.prioridade, a.confianca, a.titulo, a.acao].map(c).join(";"));
  return "﻿" + linhas.join("\n") + "\n";
}
