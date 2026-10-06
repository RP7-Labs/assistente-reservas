// Assistente sem IA: entende quarto, datas e pessoas por regras simples.
// Funções puras: recebem o histórico de mensagens do hóspede e devolvem a resposta da última.
import { validarPedido } from "./catalogo.js";
import { sugerirPeriodo } from "./periodos.js";
import { buscar, topicos, porTitulo } from "./conhecimento.js";

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
  reiniciar: /\b(recomecar|reiniciar|comecar de novo|esquece|nova reserva|outra reserva)\b/,
  reservar: /\b(reserva(?:r)?|hospedar|hospedagem|disponibilidade|vaga|quero (?:um |o |a )?quarto)\b/,
  quartos: /\b(quais|que|tipos? de|opcoes de|ver(?: os)?)\s+quartos?\b|\bquartos (?:disponiveis|voces tem|e precos)\b|^quartos?\??$/,
  preco: /\b(preco|precos|valor|valores|quanto custa|quanto fica|diaria|tarifa)\b/,
  duvidas: /^(duvidas?|tenho (?:uma )?duvida|outras duvidas|ver outras duvidas|perguntas frequentes|informacoes)\b/,
  agradecer: /\b(obrigad[oa]|valeu|agradeco|brigad[oa])\b/,
  despedida: /^(tchau|ate mais|ate logo|falou|flw)\b/,
  saudacao: /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa)\b/,
  pergunta: /\?|^(tem|tens|aceita|aceitam|pode|posso|qual|quais|como|onde|quando|quanto|que horas|voces|vcs|existe|ha|da pra|e possivel)\b/,
};

const vazio = () => ({ ativo: false, quarto: null, checkin: null, checkout: null, noites: null, adultos: null, criancas: null, periodo: null });

function faltando(e) {
  if (!e.ativo) return null;
  if (e.periodo && !e.checkin) return "opcao";
  if (!e.quarto) return "quarto";
  if (!e.checkin) return "checkin";
  if (!e.checkout && !e.noites) return "checkout";
  if (!e.adultos) return "adultos";
  return null;
}

const noitesEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const plural = (n, s, p = s + "s") => `${n} ${n === 1 ? s : p}`;
export const rotuloOpcao = (o) => `${br(o.checkin)} a ${br(o.checkout)} (${plural(noitesEntre(o.checkin, o.checkout), "noite")})`;
const brAno = (d) => d.split("-").reverse().join("/");
const textoOpcao = (o) => `de ${brAno(o.checkin)} a ${brAno(o.checkout)}`;
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const diaSemana = (d) => DIAS[new Date(d + "T12:00:00Z").getUTCDay()];

// Varia o jeito de falar, de forma previsível (mesma conversa, mesma resposta)
const variar = (lista, n) => lista[n % lista.length];

// Botões que acompanham cada pergunta. tipo "data" abre um seletor de data no chat.
const op = (rotulo, texto = rotulo, extra = {}) => ({ rotulo, texto, ...extra });
const MENU = [op("Fazer uma reserva"), op("Ver quartos e preços"), op("Dúvidas sobre o hotel"), op("Falar com atendente")];

function botoes(campo, hotel, estado, hoje) {
  if (campo === "opcao") return estado.periodo.opcoes.map((o) => op(rotuloOpcao(o), textoOpcao(o)));
  if (campo === "quarto") return hotel.quartos.map((q) => op(`${q.nome} · ${reais(q.preco_a_partir)}`, q.nome)).concat(op("Ver detalhes dos quartos"));
  if (campo === "checkin") {
    const fds = sugerirPeriodo("fim de semana", hoje);
    return [
      op("Hoje", brAno(hoje)), op("Amanhã", brAno(somarDias(hoje, 1))),
      ...(fds ? [op("Este fim de semana", "fim de semana")] : []),
      op("Escolher data", "", { tipo: "data", min: hoje }),
    ];
  }
  if (campo === "checkout") {
    return [1, 2, 3, 4].map((n) => op(`${plural(n, "noite")} · até ${br(somarDias(estado.checkin, n))}`, plural(n, "noite")))
      .concat(op("Escolher data de saída", "", { tipo: "data", min: somarDias(estado.checkin, 1) }));
  }
  if (campo === "adultos") {
    const q = hotel.quartos.find((x) => x.id === estado.quarto);
    const combos = [[1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2], [1, 1]]
      .filter(([a, c]) => !q || (a <= q.capacidade_adultos && a + c <= q.capacidade_total));
    return combos.map(([a, c]) => op(`${plural(a, "adulto")}${c ? ` + ${plural(c, "criança", "crianças")}` : ""}`, `${plural(a, "adulto")} e ${plural(c, "criança", "crianças")}`));
  }
  return [];
}

function pergunta(campo, hotel, estado, n) {
  if (campo === "opcao") {
    return `Para ${estado.periodo.nome}, separei estas opções:\n` +
      estado.periodo.opcoes.map((o, i) => `${i + 1}) ${rotuloOpcao(o)}`).join("\n") + "\nQual fica melhor? Se preferir outras datas, é só dizer.";
  }
  if (campo === "quarto") return variar(["Qual quarto você prefere?", "Qual tipo de quarto combina mais com você?"], n);
  if (campo === "checkin") return variar(["Para quando seria a entrada?", "Qual a data de chegada?"], n);
  if (campo === "checkout") return `Entrada ${diaSemana(estado.checkin)}, ${br(estado.checkin)}. ${variar(["Quantas noites você vai ficar?", "E até quando fica?"], n)}`;
  return variar(["Quantas pessoas vão se hospedar?", "Para quantas pessoas?"], n);
}

// Aplica uma mensagem ao estado do pedido
function aplicar(estado, texto, hotel, hoje) {
  const t = normalizar(texto).trim();
  const pendente = faltando(estado);
  const e = { ...estado };
  const info = [];

  if (INTENCOES.reiniciar.test(t)) return { estado: { ...vazio(), ativo: true }, info: [], entendeuAlgo: true, intencao: "reservar" };
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
  const sozinho = pendente && resto.match(new RegExp(`^(?:sao |seremos |somos |opcao |a |o )?${NUM}\\s*\\.?$`));
  if (sozinho && !datas.length) {
    const n = valorNum(sozinho[1]);
    const escolhida = pendente === "opcao" && e.periodo.opcoes[n - 1];
    if (escolhida) {
      ({ checkin: e.checkin, checkout: e.checkout } = escolhida);
      e.periodo = null;
    } else if (pendente === "adultos") e.adultos = n;
    else if (pendente === "checkout") e.noites = n;
  }

  const entendeuAlgo = Boolean(quarto || periodo || datas.length || noites || pessoas.adultos != null || pessoas.criancas != null || sozinho);
  if (entendeuAlgo || INTENCOES.reservar.test(t)) e.ativo = true;

  let intencao = null;
  let quartosListados = false;
  if (INTENCOES.quartos.test(t) || t === "ver detalhes dos quartos") {
    intencao = "info";
    quartosListados = true;
    info.push("Nossos quartos:\n" + hotel.quartos.map((q) => `• ${q.nome}: ${q.descricao} Até ${plural(q.capacidade_total, "pessoa")}. A partir de ${reais(q.preco_a_partir)} a diária.`).join("\n"));
  } else if (INTENCOES.preco.test(t) && !entendeuAlgo) {
    intencao = "info";
    const q = hotel.quartos.find((x) => x.id === e.quarto);
    info.push(q
      ? `O ${q.nome} sai a partir de ${reais(q.preco_a_partir)} a diária. O valor final aparece na página de pagamento.`
      : "As diárias começam em: " + hotel.quartos.map((x) => `${x.nome} ${reais(x.preco_a_partir)}`).join(", ") + ". O valor final aparece na página de pagamento.");
  } else if (INTENCOES.duvidas.test(t)) {
    intencao = "duvidas";
  } else if (!entendeuAlgo && !INTENCOES.reservar.test(t)) {
    // RAG: procura a resposta na base de conhecimento do hotel
    const doc = porTitulo(texto) ?? buscar(texto);
    if (doc) { intencao = "info"; info.push(doc.resposta); }
    else if (INTENCOES.agradecer.test(t)) intencao = "agradecer";
    else if (INTENCOES.despedida.test(t)) intencao = "despedida";
    else if (INTENCOES.saudacao.test(t)) intencao = "saudacao";
    else if (INTENCOES.pergunta.test(t)) intencao = "sem_resposta";
    else intencao = "nao_entendi";
  }
  if (INTENCOES.saudacao.test(t)) info.unshift(`Olá! Sou o assistente virtual do ${hotel.nome}.`);
  return { estado: e, info, entendeuAlgo, intencao, quartos: quartosListados, novoQuarto: quarto && quarto !== estado.quarto ? quarto : null };
}

// Resumo do que já foi entendido, para o hóspede conferir no caminho
function resumoParcial(e, hotel) {
  const partes = [];
  const q = hotel.quartos.find((x) => x.id === e.quarto);
  if (q) partes.push(q.nome);
  if (e.adultos) partes.push(`para ${plural(e.adultos, "adulto")}${e.criancas ? ` e ${plural(e.criancas, "criança", "crianças")}` : ""}`);
  return partes.join(" ");
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
      saida = { texto: "Certo, vou chamar alguém da equipe do hotel para continuar com você. Em breve respondemos por aqui.", acao: { tipo: "atendente", motivo: r.atendente.slice(0, 200) }, opcoes: [] };
      return;
    }

    const partes = [...r.info];
    let acao = null;
    let opcoes = null;
    let falta = faltando(estado);

    if (estado.ativo && !falta) {
      const checkout = estado.checkout ?? somarDias(estado.checkin, estado.noites);
      const pedido = { quarto_id: estado.quarto, checkin: estado.checkin, checkout, adultos: estado.adultos, criancas: estado.criancas ?? 0 };
      const v = validarPedido(hotel, pedido, new Date(hoje + "T12:00:00Z"));
      if (v.ok) {
        const pessoas = `${plural(pedido.adultos, "adulto")}${pedido.criancas ? ` e ${plural(pedido.criancas, "criança", "crianças")}` : ""}`;
        partes.push(`${variar(["Perfeito!", "Prontinho!", "Tudo certo!"], i)} ${v.quarto.nome}, de ${diaSemana(pedido.checkin)} ${br(pedido.checkin)} a ${diaSemana(checkout)} ${br(checkout)} (${plural(v.noites, "noite")}), ${pessoas}.\n` +
          `Total a partir de ${reais(v.quarto.preco_a_partir * v.noites)}.\nPara garantir, finalize por este link: {link}`);
        acao = { tipo: "link", pedido };
        estado = vazio();
        opcoes = [op("Tirar uma dúvida", "Dúvidas sobre o hotel"), op("Fazer outra reserva", "nova reserva"), op("Falar com atendente")];
      } else {
        partes.push(v.erro);
        if (/comporta|quarto/i.test(v.erro)) estado.quarto = null;
        else { estado.checkin = null; estado.checkout = null; estado.noites = null; estado.periodo = null; }
        falta = faltando(estado);
      }
    }

    if (falta) {
      // No meio da reserva: confirma o que entendeu e pergunta o próximo passo
      let q = pergunta(falta, hotel, estado, i);
      if (r.intencao === "info") q = `Voltando à sua reserva: ${q}`;
      else if (r.intencao === "sem_resposta") q = `Não tenho essa informação aqui, mas posso chamar um atendente. Voltando à sua reserva: ${q}`;
      else if (r.intencao === "nao_entendi" && !r.entendeuAlgo) q = `Desculpe, não entendi. ${q} Pode escolher uma das opções abaixo.`;
      if (r.entendeuAlgo && r.novoQuarto && falta !== "quarto") partes.push(`${variar(["Ótima escolha", "Boa escolha"], i)}, ${resumoParcial(estado, hotel)}! ${q}`);
      else if (r.entendeuAlgo) partes.push(`${variar(["Certo!", "Ótimo!", "Combinado."], i)} ${q}`);
      else partes.push(q);
      opcoes = botoes(falta, hotel, estado, hoje);
      if (r.intencao === "sem_resposta") opcoes = opcoes.concat(op("Falar com atendente"));
    } else if (!acao) {
      // Fora de uma reserva: responde e oferece o menu
      const fim = {
        saudacao: "Como posso ajudar?",
        agradecer: "Por nada! Posso ajudar em mais alguma coisa?",
        despedida: "Até mais! Quando quiser reservar, é só chamar.",
        duvidas: "Sobre o que você quer saber?",
        sem_resposta: "Não encontrei essa informação. Quer que eu chame um atendente ou prefere ver as dúvidas mais comuns?",
        nao_entendi: "Desculpe, não entendi. Posso te ajudar com uma destas opções:",
      }[r.intencao] ?? (r.quartos ? "Quer reservar algum deles?" : variar(["Posso ajudar em mais alguma coisa?", "Quer ajuda com mais alguma coisa?"], i));
      partes.push(fim);
      opcoes = r.quartos ? botoes("quarto", hotel, estado, hoje).filter((o) => o.tipo !== "data" && o.texto !== "Ver detalhes dos quartos")
        : r.intencao === "duvidas" ? topicos().map((x) => op(x)).concat(op("Falar com atendente"))
        : r.intencao === "sem_resposta" ? [op("Falar com atendente"), op("Ver outras dúvidas", "Dúvidas sobre o hotel"), op("Fazer uma reserva")]
        : r.intencao === "despedida" ? [] : MENU;
    }
    if (ultima) saida = { texto: partes.join("\n\n"), acao, opcoes: opcoes ?? [] };
  });
  return saida ?? { texto: `Olá! Sou o assistente virtual do ${hotel.nome}. Como posso ajudar?`, acao: null, opcoes: MENU };
}
