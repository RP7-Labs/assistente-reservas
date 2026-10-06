// Assistente sem IA: entende quarto, datas e pessoas por regras simples.
// Funções puras: recebem o histórico de mensagens do hóspede e devolvem a resposta da última.
import { validarPedido } from "./catalogo.js";
import { sugerirPeriodo } from "./periodos.js";

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
const NUM = `(\\d{1,2}|${Object.keys(NUMEROS).join("|")})`;

export const normalizar = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const valorNum = (s) => (/^\d+$/.test(s) ? Number(s) : NUMEROS[s]);

export function hojeSP(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

const iso = (a, m, d) => {
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
const somarDias = (data, n) => new Date(Date.parse(data) + n * 86_400_000).toISOString().slice(0, 10);
const br = (data) => data.slice(8, 10) + "/" + data.slice(5, 7);
const reais = (v) => `R$ ${Number(v).toLocaleString("pt-BR")}`;

// Dia/mês sem ano: usa o ano atual, ou o próximo se a data já passou
function comAno(dia, mes, ano, hoje) {
  if (ano) return iso(ano < 100 ? 2000 + ano : ano, mes, dia);
  const a = Number(hoje.slice(0, 4));
  const d = iso(a, mes, dia);
  return d && d < hoje ? iso(a + 1, mes, dia) : d;
}
// Só o dia: este mês, ou o próximo se já passou
function soDia(dia, hoje) {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  const d = iso(a, m, dia);
  if (d && d >= hoje) return d;
  return m === 12 ? iso(a + 1, 1, dia) : iso(a, m + 1, dia);
}

// Datas citadas na mensagem, na ordem em que aparecem
export function extrairDatas(t, hoje) {
  const achados = [];
  let resto = t;
  const marcar = (re, fn) => {
    resto = resto.replace(re, (...m) => {
      const pos = m[m.length - 2];
      const datas = fn(m).filter(Boolean);
      datas.forEach((d, i) => achados.push({ pos: pos + i / 10, d }));
      return " ".repeat(m[0].length);
    });
  };
  const mesRe = MESES.join("|");
  // intervalos: "10 a 12/10", "de 10 a 12 de outubro"
  marcar(new RegExp(`(?<![\\d/])\\b(\\d{1,2})\\s*(?:a|ate|-)\\s*(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?`, "g"), (m) => {
    const fim = comAno(+m[2], +m[3], m[4] && +m[4], hoje);
    return [fim && comAno(+m[1], +m[3], fim && +fim.slice(0, 4), hoje), fim];
  });
  marcar(new RegExp(`(?<![\\d/])\\b(\\d{1,2})\\s*(?:a|ate|-)\\s*(\\d{1,2})\\s+de\\s+(${mesRe})`, "g"), (m) => {
    const mes = MESES.indexOf(m[3]) + 1;
    const fim = comAno(+m[2], mes, null, hoje);
    return [fim && comAno(+m[1], mes, +fim.slice(0, 4), hoje), fim];
  });
  marcar(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g, (m) => [comAno(+m[1], +m[2], m[3] && +m[3], hoje)]);
  marcar(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${mesRe})`, "g"), (m) => [comAno(+m[1], MESES.indexOf(m[2]) + 1, null, hoje)]);
  marcar(/\bdia\s+(\d{1,2})\b/g, (m) => [soDia(+m[1], hoje)]);
  marcar(/\bdepois de amanha\b/g, () => [somarDias(hoje, 2)]);
  marcar(/\bamanha\b/g, () => [somarDias(hoje, 1)]);
  marcar(/\bhoje\b/g, () => [hoje]);
  marcar(new RegExp(`\\b(${SEMANA.join("|")})(?:-feira)?\\b`, "g"), (m) => {
    const alvo = SEMANA.indexOf(m[1]);
    const atual = new Date(hoje + "T12:00:00Z").getUTCDay();
    return [somarDias(hoje, ((alvo - atual + 7) % 7) || 7)];
  });
  return { datas: achados.sort((a, b) => a.pos - b.pos).map((x) => x.d), resto };
}

function extrairPessoas(t) {
  const r = {};
  let m;
  if ((m = t.match(new RegExp(`\\b${NUM}\\s+adultos?\\b`)))) r.adultos = valorNum(m[1]);
  if ((m = t.match(new RegExp(`\\b${NUM}\\s+(?:criancas?|filhos?|filhas?|bebes?|menores)\\b`)))) r.criancas = valorNum(m[1]);
  if (/\bsem (?:criancas?|filhos?)\b/.test(t)) r.criancas = 0;
  if ((m = t.match(new RegExp(`\\b${NUM}\\s+(?:pessoas|hospedes)\\b`)))) {
    const total = valorNum(m[1]);
    r.adultos ??= Math.max(total - (r.criancas ?? 0), 1);
  }
  if (r.adultos == null && /\bcasal\b/.test(t)) r.adultos = 2;
  if (r.adultos == null && /\b(sozinh[oa]|so eu|apenas eu|somente eu)\b/.test(t)) r.adultos = 1;
  return r;
}

function extrairQuarto(t, hotel) {
  let melhor = null;
  for (const q of hotel.quartos) {
    for (const nome of [q.id, q.nome, ...(q.apelidos ?? [])]) {
      const re = new RegExp(`\\b${normalizar(nome).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      let m;
      while ((m = re.exec(t))) if (!melhor || m.index >= melhor.pos) melhor = { pos: m.index, id: q.id };
    }
  }
  return melhor?.id ?? null;
}

const INTENCOES = {
  atendente: /\b(atendente|humano|pessoa de verdade|falar com (?:alguem|uma pessoa)|reclama\w*|evento|casamento|festa|grupo|empresa|corporativ\w*)\b/,
  reiniciar: /\b(recomecar|reiniciar|comecar de novo|esquece)\b/,
  quartos: /\b(quais|que|tipos? de|opcoes de)\s+quartos?\b|\bquartos (?:disponiveis|voces tem)\b|^quartos?\??$/,
  preco: /\b(preco|precos|valor|valores|quanto custa|quanto fica|diaria|tarifa)\b/,
  politicas: /\b(cafe|pet|pets|cachorro|gato|cancelamento|cancelar a reserva|check-?in|check-?out|horario|estacionamento)\b/,
  saudacao: /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa)\b/,
};

const vazio = () => ({ quarto: null, checkin: null, checkout: null, noites: null, adultos: null, criancas: null, periodo: null });

function faltando(e) {
  if (e.periodo && !e.checkin) return "opcao";
  if (!e.quarto) return "quarto";
  if (!e.checkin) return "checkin";
  if (!e.checkout && !e.noites) return "checkout";
  if (!e.adultos) return "adultos";
  return null;
}

const noitesEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const rotuloOpcao = (o) => `${br(o.checkin)} a ${br(o.checkout)} (${noitesEntre(o.checkin, o.checkout)} noite${noitesEntre(o.checkin, o.checkout) > 1 ? "s" : ""})`;
const textoOpcao = (o) => `de ${o.checkin.split("-").reverse().join("/")} a ${o.checkout.split("-").reverse().join("/")}`;

function pergunta(campo, hotel, estado) {
  if (campo === "opcao") {
    return `Para ${estado.periodo.nome}, sugiro estas datas:\n` +
      estado.periodo.opcoes.map((o, i) => `${i + 1}) ${rotuloOpcao(o)}`).join("\n") +
      "\nResponda com o número da opção ou me diga outras datas.";
  }
  return {
    quarto: `Qual quarto você prefere? Temos: ${hotel.quartos.map((q) => `${q.nome} (a partir de ${reais(q.preco_a_partir)})`).join(", ")}.`,
    checkin: "Para qual data é a entrada?",
    checkout: "E a saída? Pode me dizer a data ou quantas noites.",
    adultos: "Quantas pessoas vão se hospedar? Se tiver criança, me diga quantas.",
  }[campo];
}

// Aplica uma mensagem ao estado do pedido
function aplicar(estado, texto, hotel, hoje) {
  const t = normalizar(texto).trim();
  const pendente = faltando(estado);
  const e = { ...estado };
  const info = [];

  if (INTENCOES.reiniciar.test(t)) return { estado: vazio(), info: ["Tudo bem, vamos recomeçar."] };
  if (INTENCOES.atendente.test(t)) return { estado: e, atendente: texto };

  const { datas, resto } = extrairDatas(t, hoje);
  // Feriado citado: oferece datas para escolher (a data do próprio feriado não vira check-in)
  const periodo = datas.length < 2 ? sugerirPeriodo(t, hoje) : null;
  if (periodo) datas.length = 0;
  const pessoas = extrairPessoas(resto);
  const quarto = extrairQuarto(t, hotel);
  let m;
  const noites = (m = resto.match(new RegExp(`\\b${NUM}\\s+(?:noites?|diarias?|dias)\\b`))) ? valorNum(m[1]) : null;

  if (quarto) e.quarto = quarto;
  if (periodo) {
    e.periodo = periodo;
    e.checkin = e.checkout = e.noites = null;
  }
  if (datas.length) e.periodo = null;
  if (datas.length >= 2) {
    [e.checkin, e.checkout] = datas;
    e.noites = null;
  } else if (datas.length === 1) {
    if (pendente === "checkout" || (e.checkin && !e.checkout && datas[0] > e.checkin && pendente !== "checkin")) e.checkout = datas[0];
    else {
      e.checkin = datas[0];
      if (e.checkout && e.checkout <= e.checkin) e.checkout = null;
    }
  }
  if (noites) { e.noites = noites; e.checkout = null; }
  if (pessoas.adultos != null) e.adultos = pessoas.adultos;
  if (pessoas.criancas != null) e.criancas = pessoas.criancas;

  // Resposta curta só com número, para a pergunta que estava aberta
  const sozinho = resto.match(new RegExp(`^(?:sao |seremos |somos |opcao |a |o )?${NUM}\\s*\\.?$`));
  if (sozinho && !datas.length) {
    const n = valorNum(sozinho[1]);
    const escolhida = pendente === "opcao" && e.periodo.opcoes[n - 1];
    if (escolhida) {
      ({ checkin: e.checkin, checkout: e.checkout } = escolhida);
      e.periodo = null;
    } else if (pendente === "adultos") e.adultos = n;
    else if (pendente === "checkout") e.noites = n;
  }

  const entendeuAlgo = quarto || periodo || datas.length || noites || pessoas.adultos != null || pessoas.criancas != null || sozinho;
  if (INTENCOES.quartos.test(t) && !quarto) {
    info.push("Nossos quartos:\n" + hotel.quartos.map((q) => `• ${q.nome}: ${q.descricao} Até ${q.capacidade_total} pessoas. A partir de ${reais(q.preco_a_partir)} a diária.`).join("\n"));
  } else if (INTENCOES.preco.test(t)) {
    const q = hotel.quartos.find((x) => x.id === (quarto ?? e.quarto));
    info.push(q
      ? `${q.nome}: a partir de ${reais(q.preco_a_partir)} a diária. O valor final aparece na página de reserva.`
      : "Diárias a partir de: " + hotel.quartos.map((x) => `${x.nome} ${reais(x.preco_a_partir)}`).join(", ") + ". O valor final aparece na página de reserva.");
  }
  if (INTENCOES.politicas.test(t)) info.push(`${hotel.politicas} Check-in a partir das ${hotel.checkin} e check-out até as ${hotel.checkout}.`);
  if (INTENCOES.saudacao.test(t)) info.unshift(`Olá! Sou o assistente de reservas do ${hotel.nome}.`);
  if (quarto && quarto !== estado.quarto) info.push(`Anotado: ${hotel.quartos.find((q) => q.id === quarto).nome}.`);
  return { estado: e, info, entendeuAlgo };
}

// Responde à última mensagem, refazendo o estado a partir das anteriores
export function responderPorRegras(hotel, mensagens, hoje = hojeSP()) {
  let estado = vazio();
  let saida = null;
  mensagens.forEach((texto, i) => {
    const ultima = i === mensagens.length - 1;
    const r = aplicar(estado, texto, hotel, hoje);
    estado = r.estado;

    if (r.atendente) {
      saida = { texto: "Vou chamar um atendente do hotel para continuar com você. Em breve alguém responde por aqui.", acao: { tipo: "atendente", motivo: r.atendente.slice(0, 200) } };
      return;
    }

    let falta = faltando(estado);
    const partes = [...r.info];
    let acao = null;
    if (!falta) {
      const checkout = estado.checkout ?? somarDias(estado.checkin, estado.noites);
      const pedido = { quarto_id: estado.quarto, checkin: estado.checkin, checkout, adultos: estado.adultos, criancas: estado.criancas ?? 0 };
      const v = validarPedido(hotel, pedido, new Date(hoje + "T12:00:00Z"));
      if (v.ok) {
        const pessoas = `${pedido.adultos} adulto${pedido.adultos > 1 ? "s" : ""}${pedido.criancas ? ` e ${pedido.criancas} criança${pedido.criancas > 1 ? "s" : ""}` : ""}`;
        partes.push(`Perfeito! ${v.quarto.nome}, de ${br(pedido.checkin)} a ${br(checkout)} (${v.noites} noite${v.noites > 1 ? "s" : ""}), ${pessoas}. A partir de ${reais(v.quarto.preco_a_partir)} a diária.\nReserve por este link: {link}`);
        acao = { tipo: "link", pedido };
        estado = vazio();
        falta = null;
      } else {
        partes.push(v.erro);
        if (/comporta|quarto/i.test(v.erro)) estado.quarto = null;
        else { estado.checkin = null; estado.checkout = null; estado.noites = null; estado.periodo = null; }
        falta = faltando(estado);
      }
    }
    if (falta) {
      if (!r.entendeuAlgo && !r.info.length && falta !== "quarto" && !partes.length) partes.push("Não entendi bem.");
      partes.push(pergunta(falta, hotel, estado));
    }
    // Botões de escolha para o chat web
    const opcoes = falta === "opcao" ? estado.periodo.opcoes.map((o) => ({ rotulo: rotuloOpcao(o), texto: textoOpcao(o) })) : undefined;
    if (ultima) saida = { texto: partes.join("\n\n"), acao, ...(opcoes ? { opcoes } : {}) };
  });
  return saida ?? { texto: pergunta("quarto", hotel), acao: null };
}
