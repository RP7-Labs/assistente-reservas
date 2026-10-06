// Envio da ficha à FNRH Digital (Ministério do Turismo), API v2.4.2 para PMS.
// O hotel gera a chave em https://fnrh.turismo.serpro.gov.br/FNRH_SRH/Login > "Chaves de API".
// Sem FNRH_USUARIO/FNRH_SENHA/FNRH_CPF_SOLICITANTE, nada é enviado: a ficha fica marcada como "simulado".
import { carregarHotel } from "./catalogo.js";
import { buscarCheckin, salvarCheckin, listarCheckins, buscarReserva } from "./store.js";

const URLS = {
  producao: "https://fnrh.turismo.serpro.gov.br/FNRH_API/rest/v2",
  homologacao: "https://homlowcode.serpro.gov.br/FNRH_API/rest/v2",
};

export function configFNRH(env = process.env) {
  const { FNRH_USUARIO: usuario, FNRH_SENHA: senha, FNRH_CPF_SOLICITANTE: cpf } = env;
  if (!usuario || !senha || !cpf) return null;
  const ambiente = env.FNRH_AMBIENTE === "producao" ? "producao" : "homologacao";
  return {
    url: (env.FNRH_URL || URLS[ambiente]).replace(/\/$/, ""), ambiente, cpf: cpf.replace(/\D/g, ""),
    auth: "Basic " + Buffer.from(`${usuario}:${senha}`).toString("base64"),
    // Situação inicial do hóspede quando a ficha já foi preenchida no nosso pré-check-in (confirmar em homologação)
    situacao: env.FNRH_SITUACAO_INICIAL || "PRECHECKIN_REALIZADO",
    entradaAutomatica: env.FNRH_ENTRADA_AUTOMATICA === "1",
  };
}
export const modoFNRH = () => { const c = configFNRH(); return c ? c.ambiente : "simulado"; };

// Monta o corpo do POST /hospedagem/registrar a partir da reserva e da ficha
export function montarRegistro(reserva, hospedes, situacao = "PRECHECKIN_REALIZADO") {
  const titular = hospedes[0];
  const moraNoBrasil = titular.pais_residencia === "BR";
  return {
    reserva: {
      numero_reserva: reserva.codigo_motor,
      numero_reserva_ota: "",
      data_entrada: reserva.checkin,
      data_saida: reserva.checkout,
      quantidade_hospede_adulto: hospedes.filter((h) => !h.menor).length,
      quantidade_hospede_menor: hospedes.filter((h) => h.menor).length,
      origem_reserva_id: "MEIOHOSPEDAGEM",
    },
    dados_hospede: hospedes.map((h, i) => ({
      is_principal: i === 0,
      situacao_hospede: situacao,
      check_in_em: "",
      check_out_em: "",
      dados_pessoais: {
        nome: h.nome.toUpperCase(),
        nome_social: "",
        PaisNacionalidade_id: h.nacionalidade,
        genero_id: h.genero,
        GeneroDescricao: h.genero_descricao ?? "",
        data_nascimento: h.nascimento,
        raca_id: h.raca,
        deficiencia_id: h.deficiencia,
        tipo_deficiencia_id: h.tipo_deficiencia ?? "",
        documento_id: { numero_documento: h.documento_numero, tipo_documento_id: h.documento_tipo },
        // Acompanhantes moram com o titular (suposição: a ficha só pergunta o endereço do titular)
        contato: {
          email: i === 0 ? titular.email : "",
          telefone: i === 0 ? titular.telefone : "",
          PaisResidencia_id: titular.pais_residencia,
          ...(moraNoBrasil ? { cidade_id: titular.cidade_id, estado_id: titular.uf } : {}),
        },
      },
      responsavel: h.menor
        ? { numero_documento: titular.documento_numero, tipo_documento_id: titular.documento_tipo }
        : { numero_documento: "", tipo_documento_id: "" },
      dados_ficha: { motivo_viagem_id: titular.motivo, meio_transporte_id: titular.transporte },
    })),
  };
}

async function chamar(cfg, caminho, { metodo = "POST", corpo, texto } = {}, buscarFn = fetch) {
  const r = await buscarFn(`${cfg.url}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: cfg.auth, cpf_solicitante: cfg.cpf,
      // Check-in e check-out recebem só a data e hora em texto, não JSON
      "Content-Type": texto != null ? "text/plain" : "application/json",
    },
    body: texto ?? (corpo ? JSON.stringify(corpo) : undefined),
    signal: AbortSignal.timeout(20_000),
  });
  const bruto = await r.text();
  let j = null;
  try { j = bruto ? JSON.parse(bruto) : null; } catch { /* corpo não-JSON */ }
  if (!r.ok) throw new Error(`FNRH ${r.status}: ${j?.mensagem ?? j?.erro ?? (bruto.slice(0, 200) || "sem detalhe")}`);
  return j;
}

const agoraUTC = (d = new Date()) => d.toISOString();

// Registra a reserva e os hóspedes na FNRH depois do pré-check-in
export async function registrarFicha(codigo, { cfg = configFNRH(), buscarFn = fetch } = {}) {
  const ck = await buscarCheckin({ codigo });
  const reserva = await buscarReserva(codigo);
  if (!ck?.hospedes?.length || !reserva) return ck;
  if (ck.fnrh_reserva_id) return ck;
  if (!cfg) return salvarCheckin({ ...ck, fnrh_status: "simulado", fnrh_erro: null });
  try {
    const j = await chamar(cfg, "/hospedagem/registrar", { corpo: montarRegistro(reserva, ck.hospedes, cfg.situacao) }, buscarFn);
    const r = j?.dados?.reserva ?? {};
    return salvarCheckin({ ...ck, fnrh_status: "registrado", fnrh_reserva_id: r.reserva_id ?? null, fnrh_link: r.link_precheckin ?? null, fnrh_erro: null });
  } catch (err) {
    return salvarCheckin({ ...ck, fnrh_status: "erro", fnrh_erro: err.message.slice(0, 300) });
  }
}

// Entrada, saída, cancelamento e no-show da reserva já registrada
export async function eventoFNRH(codigo, evento, { cfg = configFNRH(), buscarFn = fetch, quando = new Date() } = {}) {
  const ck = await buscarCheckin({ codigo }).catch(() => null);
  if (!ck) return null;
  if (!cfg || !ck.fnrh_reserva_id) {
    const campo = { entrada: "fnrh_entrada_em", saida: "fnrh_saida_em" }[evento];
    return campo ? salvarCheckin({ ...ck, [campo]: agoraUTC(quando) }) : ck;
  }
  const id = encodeURIComponent(ck.fnrh_reserva_id);
  try {
    if (evento === "entrada") {
      await chamar(cfg, `/reservas/${id}/checkin`, { texto: agoraUTC(quando) }, buscarFn);
      return salvarCheckin({ ...ck, fnrh_entrada_em: agoraUTC(quando), fnrh_erro: null });
    }
    if (evento === "saida") {
      await chamar(cfg, `/reservas/${id}/checkout`, { texto: agoraUTC(quando) }, buscarFn);
      return salvarCheckin({ ...ck, fnrh_saida_em: agoraUTC(quando), fnrh_erro: null });
    }
    // Só reservas que ainda não tiveram entrada podem ser canceladas na FNRH
    if (evento === "cancelar" && !ck.fnrh_entrada_em) await chamar(cfg, `/reservas/${id}/cancelar`, {}, buscarFn);
    if (evento === "noshow" && !ck.fnrh_entrada_em) await chamar(cfg, `/reservas/${id}/noshow`, {}, buscarFn);
    return salvarCheckin({ ...ck, fnrh_status: evento === "cancelar" ? "cancelado" : evento === "noshow" ? "noshow" : ck.fnrh_status, fnrh_erro: null });
  } catch (err) {
    return salvarCheckin({ ...ck, fnrh_erro: `${evento}: ${err.message}`.slice(0, 300) });
  }
}

// Tarefa agendada: tenta de novo os registros com erro, registra a saída no horário de check-out
// e, com FNRH_ENTRADA_AUTOMATICA=1, a entrada no horário de check-in.
export async function tarefasFNRH({ agora = new Date(), cfg = configFNRH(), buscarFn = fetch } = {}) {
  if (!cfg) return { ativo: false };
  const hotel = carregarHotel();
  const checkins = await listarCheckins().catch(() => []);
  const feito = { registrados: 0, entradas: 0, saidas: 0 };
  for (const ck of checkins.filter((c) => c.status === "concluido")) {
    const reserva = await buscarReserva(ck.codigo_reserva);
    if (!reserva || !["confirmada", "concluida"].includes(reserva.status)) continue;
    if (!ck.fnrh_reserva_id) {
      if (reserva.checkout >= agora.toISOString().slice(0, 10) && (await registrarFicha(ck.codigo_reserva, { cfg, buscarFn }))?.fnrh_reserva_id) feito.registrados++;
      continue;
    }
    const entrada = new Date(`${reserva.checkin}T${hotel.checkin || "14:00"}:00-03:00`);
    const saida = new Date(`${reserva.checkout}T${hotel.checkout || "12:00"}:00-03:00`);
    if (!ck.fnrh_entrada_em && cfg.entradaAutomatica && agora >= entrada) {
      if ((await eventoFNRH(ck.codigo_reserva, "entrada", { cfg, buscarFn, quando: entrada }))?.fnrh_entrada_em) feito.entradas++;
    } else if (ck.fnrh_entrada_em && !ck.fnrh_saida_em && agora >= saida) {
      if ((await eventoFNRH(ck.codigo_reserva, "saida", { cfg, buscarFn, quando: saida }))?.fnrh_saida_em) feito.saidas++;
    }
  }
  return { ativo: true, ...feito };
}
