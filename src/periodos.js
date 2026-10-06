// Feriados e períodos com nome ("natal", "carnaval", "fim de semana"):
// devolvem opções de entrada e saída para o hóspede escolher no chat.

const dia = (a, m, d) => new Date(Date.UTC(a, m - 1, d));
const somar = (dt, n) => new Date(dt.getTime() + n * 86_400_000);
const iso = (dt) => dt.toISOString().slice(0, 10);
const op = (ini, fim) => ({ checkin: iso(ini), checkout: iso(fim) });

// Domingo de Páscoa (algoritmo de Meeus/Butcher)
export function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), d2 = ((h + l - 7 * m + 114) % 31) + 1;
  return dia(ano, mes, d2);
}

// Feriadão em torno de um feriado fixo: emenda o fim de semana (e a ponte, se cair na terça ou quinta)
function feriadao(data) {
  const sem = data.getUTCDay(); // 0 dom ... 6 sáb
  let ini = data, fim = data;
  if (sem === 1) ini = somar(data, -2);            // seg: sáb a seg
  else if (sem === 2) ini = somar(data, -3);       // ter: sáb a ter (ponte na seg)
  else if (sem === 4) fim = somar(data, 3);        // qui: qui a dom (ponte na sex)
  else if (sem === 5) fim = somar(data, 2);        // sex: sex a dom
  else if (sem === 6) fim = somar(data, 1);        // sáb: sáb a dom
  else if (sem === 0) ini = somar(data, -1);       // dom: sáb a dom
  // checkout no dia seguinte ao último dia de folga; opção de chegar na véspera
  return [op(ini, somar(fim, 1)), op(somar(ini, -1), somar(fim, 1))];
}

const PERIODOS = [
  { nome: "o Réveillon", re: /\b(reveillon|ano novo|virada(?: do ano)?)\b/, opcoes: (a) => [op(dia(a, 12, 30), dia(a + 1, 1, 1)), op(dia(a, 12, 31), dia(a + 1, 1, 2)), op(dia(a, 12, 29), dia(a + 1, 1, 2))] },
  { nome: "as festas de fim de ano", re: /\b(festas de fim de ano|fim de ano|final de ano)\b/, opcoes: (a) => [op(dia(a, 12, 23), dia(a + 1, 1, 2)), op(dia(a, 12, 23), dia(a, 12, 27)), op(dia(a, 12, 29), dia(a + 1, 1, 2))] },
  { nome: "o Natal", re: /\b(natal|noite de natal|ceia)\b/, opcoes: (a) => [op(dia(a, 12, 24), dia(a, 12, 26)), op(dia(a, 12, 23), dia(a, 12, 26)), op(dia(a, 12, 24), dia(a, 12, 27))] },
  { nome: "o Carnaval", re: /\bcarnaval\b/, opcoes: (a) => { const p = pascoa(a); return [op(somar(p, -50), somar(p, -46)), op(somar(p, -51), somar(p, -46)), op(somar(p, -50), somar(p, -47))]; } },
  { nome: "a Semana Santa", re: /\b(semana santa|pascoa|sexta-?feira santa|sexta santa)\b/, opcoes: (a) => { const p = pascoa(a); return [op(somar(p, -3), p), op(somar(p, -2), p), op(somar(p, -3), somar(p, 1))]; } },
  { nome: "o feriado de Corpus Christi", re: /\bcorpus christi\b/, opcoes: (a) => { const c = somar(pascoa(a), 60); return [op(c, somar(c, 3)), op(somar(c, -1), somar(c, 3)), op(c, somar(c, 2))]; } },
  { nome: "o feriado de Tiradentes", re: /\btiradentes\b/, opcoes: (a) => feriadao(dia(a, 4, 21)) },
  { nome: "o feriado do Dia do Trabalho", re: /\b(dia do trabalho(?:dor)?|primeiro de maio|1o? de maio)\b/, opcoes: (a) => feriadao(dia(a, 5, 1)) },
  { nome: "o feriado da Independência", re: /\b(independencia|7 de setembro|sete de setembro)\b/, opcoes: (a) => feriadao(dia(a, 9, 7)) },
  { nome: "o feriado de Nossa Senhora Aparecida", re: /\b(nossa senhora|aparecida|dia das criancas)\b/, opcoes: (a) => feriadao(dia(a, 10, 12)) },
  { nome: "o feriado de Finados", re: /\bfinados\b/, opcoes: (a) => feriadao(dia(a, 11, 2)) },
  { nome: "o feriado da Proclamação da República", re: /\b(proclamacao|15 de novembro)\b/, opcoes: (a) => feriadao(dia(a, 11, 15)) },
  { nome: "o feriado da Consciência Negra", re: /\b(consciencia negra|20 de novembro)\b/, opcoes: (a) => feriadao(dia(a, 11, 20)) },
];

function fimDeSemana(hojeStr) {
  const hoje = new Date(hojeStr + "T00:00:00Z");
  const sem = hoje.getUTCDay();
  let sexta = somar(hoje, (5 - sem + 7) % 7);
  if (sem === 6) sexta = somar(hoje, -1);          // sábado: este fim de semana já começou
  if (sem === 0) sexta = somar(hoje, 5);           // domingo: o próximo
  const opcoes = [op(sexta, somar(sexta, 2)), op(somar(sexta, 1), somar(sexta, 2)), op(sexta, somar(sexta, 3))];
  return opcoes.filter((o) => o.checkin >= hojeStr);
}

// Devolve { nome, opcoes } se a mensagem citar um período conhecido; senão null
export function sugerirPeriodo(t, hoje) {
  if (/\b(fim de semana|final de semana|fds)\b/.test(t)) {
    const opcoes = fimDeSemana(hoje);
    return opcoes.length ? { nome: "o fim de semana", opcoes } : null;
  }
  const anoHoje = Number(hoje.slice(0, 4));
  const anoDito = t.match(/\b(20\d{2})\b/);
  for (const p of PERIODOS) {
    if (!p.re.test(t)) continue;
    // O próximo que ainda não passou (ou o ano citado)
    for (const ano of anoDito ? [Number(anoDito[1])] : [anoHoje - 1, anoHoje, anoHoje + 1]) {
      const opcoes = p.opcoes(ano).filter((o) => o.checkin >= hoje);
      if (opcoes.length) return { nome: p.nome, opcoes };
    }
  }
  return null;
}
