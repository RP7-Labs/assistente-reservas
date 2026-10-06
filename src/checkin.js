// Check-in digital: link de pré-check-in, ficha dos hóspedes, unidade e senha da fechadura.
import crypto from "node:crypto";
import express from "express";
import { carregarHotel } from "./catalogo.js";
import {
  buscarCheckin, salvarCheckin, listarCheckins, listarUnidades, buscarReserva, listarDados, listarPagamentos,
} from "./store.js";
import { configTTLock, criarSenhaTTLock, apagarSenhaTTLock, novaSenha } from "./fechaduras.js";
import { enviarEmail } from "./email.js";
import { emailValido, normalizarEmail } from "./auth.js";
import { registrarFicha } from "./fnrh.js";

const ATIVAS = new Set(["confirmada", "concluida"]);
const br = (d) => String(d).slice(0, 10).split("-").reverse().join("/");
const AVISO_TESTE = "\n\n(Ambiente de testes.)";

export const linkCheckin = (base, token) => `${String(base).replace(/\/$/, "")}/checkin?c=${encodeURIComponent(token)}`;

// Cria o registro de check-in da reserva (com o token do link), se ainda não existir
export async function garantirCheckin(codigo) {
  const atual = await buscarCheckin({ codigo });
  if (atual) return atual;
  return salvarCheckin({ codigo_reserva: codigo, token: crypto.randomBytes(18).toString("base64url"), status: "pendente" });
}

// Janela da senha: do horário de check-in no dia da entrada ao horário de check-out no dia da saída (horário de Brasília)
export function janelaSenha(hotel, reserva) {
  const hora = (h, padrao) => (/^\d{2}:\d{2}$/.test(h ?? "") ? h : padrao);
  return {
    inicio: new Date(`${reserva.checkin}T${hora(hotel.checkin, "14:00")}:00-03:00`),
    fim: new Date(`${reserva.checkout}T${hora(hotel.checkout, "12:00")}:00-03:00`),
  };
}

// Escolhe uma unidade livre do tipo de quarto: nenhuma outra reserva ativa usa a mesma unidade no período
export function escolherUnidade({ reserva, unidades, checkins, reservas }) {
  const porCodigo = new Map(reservas.map((r) => [r.codigo_motor, r]));
  const ocupadas = new Set(checkins
    .filter((c) => c.codigo_reserva !== reserva.codigo_motor && c.unidade)
    .filter((c) => {
      const r = porCodigo.get(c.codigo_reserva);
      return r && ATIVAS.has(r.status) && r.checkin < reserva.checkout && reserva.checkin < r.checkout;
    })
    .map((c) => c.unidade));
  return unidades.find((u) => u.ativa !== false && u.quarto_id === reserva.quarto_id && !ocupadas.has(u.numero)) ?? null;
}

// Gera (ou troca) a senha da reserva. Com fechadura e TTLock configurada, grava na fechadura; senão, simula.
export async function emitirSenha(codigo, { buscarFn = fetch, cfg = configTTLock() } = {}) {
  const hotel = carregarHotel();
  const reserva = await buscarReserva(codigo);
  if (!reserva || !ATIVAS.has(reserva.status)) throw new Error("Reserva não está confirmada.");
  let ck = await garantirCheckin(codigo);
  if (ck.senha_id && ck.senha_status === "ativa") await revogarSenha(codigo, { buscarFn, cfg });
  ck = await buscarCheckin({ codigo });

  const [unidades, checkins, { reservas }] = await Promise.all([listarUnidades(), listarCheckins(), listarDados()]);
  const atual = ck.unidade && unidades.find((u) => u.numero === ck.unidade && u.quarto_id === reserva.quarto_id);
  const unidade = atual || escolherUnidade({ reserva, unidades, checkins, reservas });
  if (!unidade) return salvarCheckin({ ...ck, senha_status: "sem_unidade", senha_erro: "Nenhuma unidade livre cadastrada para este tipo de quarto." });

  const { inicio, fim } = janelaSenha(hotel, reserva);
  const senha = novaSenha();
  const base = { ...ck, unidade: unidade.numero, senha, senha_inicio: inicio.toISOString(), senha_fim: fim.toISOString(), senha_erro: null };
  if (!unidade.lock_id || !cfg) return salvarCheckin({ ...base, senha_id: null, senha_status: "simulada" });
  try {
    const { id } = await criarSenhaTTLock({ lockId: unidade.lock_id, senha, nome: `${codigo} ${reserva.hospede ?? ""}`.trim(), inicio, fim }, cfg, buscarFn);
    return salvarCheckin({ ...base, senha_id: id, senha_status: "ativa" });
  } catch (err) {
    return salvarCheckin({ ...base, senha: null, senha_id: null, senha_status: "erro", senha_erro: err.message.slice(0, 300) });
  }
}

// Apaga a senha da fechadura (reserva cancelada, troca de senha ou pedido do hotel)
export async function revogarSenha(codigo, { buscarFn = fetch, cfg = configTTLock() } = {}) {
  const ck = await buscarCheckin({ codigo }).catch(() => null);
  if (!ck || !ck.senha_status || ck.senha_status === "revogada") return ck;
  if (ck.senha_id) {
    const unidade = (await listarUnidades()).find((u) => u.numero === ck.unidade);
    try {
      if (unidade?.lock_id && cfg) await apagarSenhaTTLock({ lockId: unidade.lock_id, senhaId: ck.senha_id }, cfg, buscarFn);
    } catch (err) {
      return salvarCheckin({ ...ck, senha_erro: `Não consegui apagar na fechadura: ${err.message}`.slice(0, 300) });
    }
  }
  return salvarCheckin({ ...ck, senha: null, senha_id: null, senha_status: "revogada", senha_erro: null });
}

// ---- Ficha dos hóspedes ----
// Campos e códigos da Ficha Nacional de Registro de Hóspedes (API FNRH Digital v2.4.2),
// para a ficha poder ser enviada ao governo sem conversão. Ver src/fnrh.js.

export const MOTIVOS = { LAZER_FERIAS: "Lazer / férias", NEGOCIOS: "Negócios", CONGRESSO_FEIRA: "Congresso / feira", PARENTES_AMIGOS: "Parentes / amigos", ESTUDOS_CURSOS: "Estudos / cursos", SAUDE: "Saúde", RELIGIAO: "Religião", COMPRAS: "Compras" };
export const TRANSPORTES = { AUTOMOVEL: "Carro", AVIAO: "Avião", ONIBUS: "Ônibus", MOTO: "Moto", TREM: "Trem", NAVIO_BARCO: "Navio / barco", BICICLETA: "Bicicleta", PE: "A pé" };
export const DOCUMENTOS = { CPF: "CPF", PASSAPORTE: "Passaporte" };
export const GENEROS = { MULHER: "Feminino", HOMEM: "Masculino", OUTRO: "Outro", NAOINFORMADO: "Prefiro não informar" };
export const RACAS = { BRANCA: "Branca", PARDA: "Parda", PRETA: "Preta", AMARELA: "Amarela", INDIGENA: "Indígena", NAOINFORMAR: "Prefiro não informar" };
export const DEFICIENCIAS = { NAO: "Não", SIM: "Sim", NAOINFORMAR: "Prefiro não informar" };
export const TIPOS_DEFICIENCIA = { FISICA: "Física", AUDITIVA_SURDEZ: "Auditiva / surdez", VISUAL: "Visual", INTELECTUAL: "Intelectual", MULTIPLA: "Múltipla" };
// Países mais comuns (ISO 3166-1 alfa-2); "outro" aceita qualquer código de 2 letras
export const PAISES = { BR: "Brasil", AR: "Argentina", UY: "Uruguai", PY: "Paraguai", CL: "Chile", BO: "Bolívia", PE: "Peru", CO: "Colômbia", VE: "Venezuela", MX: "México", US: "Estados Unidos", CA: "Canadá", PT: "Portugal", ES: "Espanha", IT: "Itália", FR: "França", DE: "Alemanha", GB: "Reino Unido", JP: "Japão", CN: "China" };
export const OPCOES_FICHA = { motivos: MOTIVOS, transportes: TRANSPORTES, documentos: DOCUMENTOS, generos: GENEROS, racas: RACAS, deficiencias: DEFICIENCIAS, tipos_deficiencia: TIPOS_DEFICIENCIA, paises: PAISES };

export function cpfValido(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dig = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

const texto = (v, max = 120) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const pais = (v) => (/^[A-Za-z]{2}$/.test(String(v ?? "").trim()) ? String(v).trim().toUpperCase() : "");
const dominio = (mapa, v, padrao) => (mapa[v] ? v : padrao);
export const idade = (nasc, ref) => {
  const [a, m, d] = nasc.split("-").map(Number), [ra, rm, rd] = ref.split("-").map(Number);
  return ra - a - (rm < m || (rm === m && rd < d) ? 1 : 0);
};

// Valida e limpa a ficha enviada pelo hóspede. Devolve { erro } ou { hospedes, chegada_prevista }.
export function validarFicha(corpo, reserva) {
  const lista = Array.isArray(corpo?.hospedes) ? corpo.hospedes.slice(0, 12) : [];
  const total = Number(reserva.adultos ?? 1) + Number(reserva.criancas ?? 0);
  if (!lista.length) return { erro: "Preencha os dados de pelo menos um hóspede." };
  if (reserva.adultos && lista.length < total) return { erro: `A reserva é para ${total} pessoa${total > 1 ? "s" : ""}: preencha todas.` };
  const hospedes = [];
  for (const [i, h] of lista.entries()) {
    const quem = i === 0 ? "Titular" : `Hóspede ${i + 1}`;
    const nome = texto(h.nome);
    const nascimento = String(h.nascimento ?? "");
    if (nome.split(" ").length < 2) return { erro: `${quem}: informe o nome completo.` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nascimento) || nascimento > reserva.checkin || nascimento < "1900-01-01") return { erro: `${quem}: data de nascimento inválida.` };
    const menor = idade(nascimento, reserva.checkin) < 18;
    if (i === 0 && menor) return { erro: "O titular precisa ser maior de idade." };
    const nacionalidade = pais(h.nacionalidade);
    if (!nacionalidade) return { erro: `${quem}: escolha a nacionalidade.` };
    const documento_tipo = dominio(DOCUMENTOS, h.documento_tipo, "");
    const bruto = texto(h.documento_numero, 30);
    const documento_numero = documento_tipo === "CPF" ? bruto.replace(/\D/g, "") : bruto.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    // A FNRH pede documento de todos, inclusive crianças (CPF da certidão ou passaporte)
    if (!documento_tipo || !documento_numero) return { erro: `${quem}: informe o CPF ou o passaporte.` };
    if (documento_tipo === "CPF" && !cpfValido(documento_numero)) return { erro: `${quem}: CPF inválido.` };
    const genero = dominio(GENEROS, h.genero, "NAOINFORMADO");
    const deficiencia = dominio(DEFICIENCIAS, h.deficiencia, "NAOINFORMAR");
    const tipo_deficiencia = deficiencia === "SIM" ? dominio(TIPOS_DEFICIENCIA, h.tipo_deficiencia, "") : null;
    if (deficiencia === "SIM" && !tipo_deficiencia) return { erro: `${quem}: escolha o tipo de deficiência.` };
    const item = {
      nome, nascimento, menor, nacionalidade, documento_tipo, documento_numero,
      genero, genero_descricao: genero === "OUTRO" ? texto(h.genero_descricao, 40) || null : null,
      raca: dominio(RACAS, h.raca, "NAOINFORMAR"), deficiencia, tipo_deficiencia,
    };
    if (i === 0) {
      const email = normalizarEmail(h.email);
      if (!emailValido(email)) return { erro: "Titular: e-mail inválido." };
      const telefone = String(h.telefone ?? "").replace(/\D/g, "");
      if (telefone.length < 10) return { erro: "Titular: informe o celular com DDD." };
      const pais_residencia = pais(h.pais_residencia) || "BR";
      const res = { email, telefone, pais_residencia };
      if (pais_residencia === "BR") {
        // Município pelo código do IBGE (7 dígitos), como a FNRH exige para quem mora no Brasil
        const cidade_id = String(h.cidade_id ?? "").replace(/\D/g, "");
        const uf = texto(h.uf, 2).toUpperCase();
        if (!/^[A-Z]{2}$/.test(uf) || !/^\d{7}$/.test(cidade_id)) return { erro: "Titular: escolha o estado e a cidade onde mora." };
        Object.assign(res, { uf, cidade_id: Number(cidade_id), cidade: texto(h.cidade, 80) || null });
      } else res.cidade = texto(h.cidade, 80) || null;
      Object.assign(item, res, {
        motivo: dominio(MOTIVOS, h.motivo, "LAZER_FERIAS"),
        transporte: dominio(TRANSPORTES, h.transporte, "AUTOMOVEL"),
      });
    }
    hospedes.push(item);
  }
  if (!corpo?.aceite) return { erro: "Para continuar, aceite o uso dos dados para o registro de hóspedes." };
  return { hospedes, chegada_prevista: /^\d{2}:\d{2}$/.test(corpo.chegada_prevista ?? "") ? corpo.chegada_prevista : null };
}

// ---- E-mails ----

export function textoLinkCheckin(base, token) {
  return `Adiante o check-in pelo celular (leva 2 minutos). Assim você recebe a senha da porta e não precisa passar na recepção:\n${linkCheckin(base, token)}`;
}

async function emailSenha(hotel, reserva, ck) {
  const titular = ck.hospedes?.[0];
  if (!titular?.email) return;
  const temSenha = ck.senha && ["ativa", "simulada"].includes(ck.senha_status);
  const corpo = temSenha
    ? `Check-in concluído! Seu quarto é o ${ck.unidade}.\n\nSenha da porta: ${ck.senha}\nVale de ${new Date(ck.senha_inicio).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} até ${new Date(ck.senha_fim).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}.\n\nDigite a senha no teclado da fechadura e confirme. Guarde este e-mail; não compartilhe a senha.`
    : "Check-in concluído! Recebemos seus dados. A recepção vai entregar o acesso ao quarto na chegada.";
  await enviarEmail({
    para: titular.email, tipo: "checkin_concluido", leadId: reserva.lead_id ?? null,
    assunto: `Check-in da reserva ${reserva.codigo_motor} – ${hotel.nome}`,
    texto: `Olá, ${titular.nome.split(" ")[0]}!\n\n${corpo}\n\nEntrada: ${br(reserva.checkin)} · Saída: ${br(reserva.checkout)}, até as ${hotel.checkout}\n\n${hotel.nome}${AVISO_TESTE}`,
  });
}

// ---- Rotas públicas do pré-check-in ----

export const checkin = express.Router();

const rota = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Não foi possível concluir. Tente de novo." });
  }
};

async function carregar(token) {
  const ck = token && (await buscarCheckin({ token }));
  const reserva = ck && (await buscarReserva(ck.codigo_reserva));
  if (!ck || !reserva) return null;
  // Adultos e crianças vêm do link do assistente (lead) quando houver
  const { leads } = await listarDados();
  const lead = leads.find((l) => l.id === reserva.lead_id);
  const pag = lead && (await listarPagamentos()).find((p) => p.lead_id === lead.id);
  return { ck, reserva: { ...reserva, adultos: lead?.adultos ?? 1, criancas: lead?.criancas ?? 0, email: pag?.email, telefone: pag?.telefone }, hotel: carregarHotel() };
}

checkin.get("/:token", rota(async (req, res) => {
  const c = await carregar(req.params.token);
  if (!c) return res.status(404).json({ erro: "Link de check-in não encontrado." });
  const { ck, reserva, hotel } = c;
  const quarto = hotel.quartos.find((q) => q.id === reserva.quarto_id);
  const concluido = ck.status === "concluido";
  res.json({
    hotel: { nome: hotel.nome, checkin: hotel.checkin, checkout: hotel.checkout },
    reserva: {
      codigo: reserva.codigo_motor, quarto: quarto?.nome ?? reserva.quarto_id, checkin: reserva.checkin, checkout: reserva.checkout,
      adultos: reserva.adultos, criancas: reserva.criancas, ativa: ATIVAS.has(reserva.status),
    },
    // Só o que ajuda a preencher; documentos já enviados não voltam para a página
    sugestao: concluido ? null : { nome: reserva.hospede, email: reserva.email, telefone: reserva.telefone },
    opcoes: OPCOES_FICHA,
    concluido,
    acesso: concluido ? { unidade: ck.unidade, senha: ["ativa", "simulada"].includes(ck.senha_status) ? ck.senha : null, inicio: ck.senha_inicio, fim: ck.senha_fim, simulada: ck.senha_status === "simulada" } : null,
  });
}));

checkin.post("/:token", rota(async (req, res) => {
  const c = await carregar(req.params.token);
  if (!c) return res.status(404).json({ erro: "Link de check-in não encontrado." });
  const { ck, reserva, hotel } = c;
  if (!ATIVAS.has(reserva.status)) return res.status(409).json({ erro: "Esta reserva não está ativa." });
  if (ck.status === "concluido") return res.status(409).json({ erro: "O check-in desta reserva já foi feito." });
  if (reserva.checkout <= new Date().toISOString().slice(0, 10)) return res.status(409).json({ erro: "O período desta reserva já terminou." });
  const v = validarFicha(req.body, reserva);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  await salvarCheckin({ ...ck, hospedes: v.hospedes, chegada_prevista: v.chegada_prevista, status: "concluido", concluido_em: new Date().toISOString() });
  // Ficha vai para a FNRH Digital (ou fica "simulado" sem credenciais); uma falha aqui não segura a senha
  await registrarFicha(reserva.codigo_motor).catch((err) => console.error("FNRH:", err.message));
  const final = await emitirSenha(reserva.codigo_motor);
  await emailSenha(hotel, reserva, final).catch((err) => console.error("e-mail do check-in:", err.message));
  res.json({ ok: true });
}));
