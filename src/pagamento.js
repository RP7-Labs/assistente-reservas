// Checkout próprio: cartão com pré-autorização e Pix. Com as chaves da Getnet cobra de verdade
// (src/getnet.js); sem elas, tudo é simulado e nada é cobrado.
import crypto from "node:crypto";
import express from "express";
import { carregarHotel, precoTotal, noHotel } from "./catalogo.js";
import { HOTEL_PADRAO } from "./tenant.js";
import { dinheiro } from "./paises.js";
import { localizarHotel, buscarLead, buscarPagamento, salvarPagamento, salvarReserva, listarDados, pagamentosSemLembrete } from "./store.js";
import { disponibilidade } from "./backoffice.js";
import { sincronizarCanais, bloqueiosOuNada } from "./canais.js";
import { enviarEmail } from "./email.js";
import { emailValido, normalizarEmail } from "./auth.js";
import { garantirCheckin, linkCheckin } from "./checkin.js";
import { linkGuia, textoLinkGuia } from "./guia.js";
import { enviar as enviarWhatsapp } from "./whatsapp.js";
import { enviarMeta } from "./rastreio.js";
import * as getnet from "./getnet.js";

export const MINUTOS_LEMBRETE = 5;
// Cartão de teste que sempre é recusado
export const CARTAO_RECUSADO = "4000000000000002";
const FINAIS = new Set(["pre_autorizado", "capturado", "pago"]);

export function luhn(numero) {
  let soma = 0;
  for (let i = 0; i < numero.length; i++) {
    let d = Number(numero[numero.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    soma += d;
  }
  return soma % 10 === 0;
}

export function bandeira(numero) {
  if (/^4/.test(numero)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(numero)) return "Mastercard";
  if (/^3[47]/.test(numero)) return "Amex";
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(numero)) return "Elo";
  if (/^(606282|3841)/.test(numero)) return "Hipercard";
  return "Cartão";
}

// Valida os dados do cartão (simulado). Devolve { ok, erro?, final, bandeira }
export function validarCartao({ numero, validade, cvv, nome }, agora = new Date()) {
  const n = String(numero ?? "").replace(/\D/g, "");
  if (n.length < 13 || n.length > 19 || !luhn(n)) return { ok: false, erro: "Número do cartão inválido." };
  const m = String(validade ?? "").match(/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m || +m[1] < 1 || +m[1] > 12) return { ok: false, erro: "Validade inválida. Use MM/AA." };
  const ano = m[2].length === 2 ? 2000 + +m[2] : +m[2];
  if (ano * 12 + +m[1] < agora.getUTCFullYear() * 12 + agora.getUTCMonth() + 1) return { ok: false, erro: "Cartão vencido." };
  if (!/^\d{3,4}$/.test(String(cvv ?? ""))) return { ok: false, erro: "CVV inválido." };
  if (!String(nome ?? "").trim()) return { ok: false, erro: "Informe o nome impresso no cartão." };
  if (n === CARTAO_RECUSADO) return { ok: false, erro: "Pagamento recusado pelo emissor (cartão de teste de recusa).", recusado: true };
  return { ok: true, final: n.slice(-4), bandeira: bandeira(n) };
}

// Código Pix "copia e cola" de mentira, com o formato parecido com o real
export function pixFake(txid, valor, hotel) {
  const campo = (id, v) => id + String(v.length).padStart(2, "0") + v;
  const corpo = campo("00", "01") + campo("26", campo("00", "br.gov.bcb.pix") + campo("01", "pagamento-simulado@exemplo.com")) +
    campo("52", "0000") + campo("53", "986") + campo("54", valor.toFixed(2)) + campo("58", "BR") +
    campo("59", (hotel.nome || "HOTEL").slice(0, 25)) + campo("60", (hotel.cidade || "CIDADE").slice(0, 15)) + campo("62", campo("05", txid)) + "6304";
  return corpo + crypto.createHash("sha256").update(corpo).digest("hex").slice(0, 4).toUpperCase();
}

const noitesDe = (l) => Math.round((Date.parse(l.checkout) - Date.parse(l.checkin)) / 86_400_000);

export function resumoPedido(hotel, lead) {
  const quarto = hotel.quartos.find((q) => q.id === lead.quarto_id);
  const noites = noitesDe(lead);
  return {
    lead_id: lead.id, hotel: hotel.nome, moeda: hotel.moeda ?? "BRL", idioma: hotel.idioma ?? "pt-BR", quarto: quarto?.nome ?? lead.quarto_id, quarto_id: lead.quarto_id,
    checkin: lead.checkin, checkout: lead.checkout, noites, adultos: lead.adultos, criancas: lead.criancas,
    diaria: quarto?.preco_a_partir ?? 0, total: precoTotal(quarto, noites), mensal: Boolean(quarto?.preco_mensal && precoTotal(quarto, noites) !== (quarto?.preco_a_partir ?? 0) * noites),
  };
}

// Confere se há quarto livre em todas as noites da estadia (reservas daqui e bloqueios do Airbnb e outros canais)
async function temVaga(hotel, lead) {
  // Lê de novo os calendários externos vencidos, para não vender uma noite já reservada no Airbnb
  await sincronizarCanais().catch((err) => console.error("iCal:", err.message));
  const [{ leads, reservas }, bloqueios] = await Promise.all([listarDados(), bloqueiosOuNada()]);
  for (let d = lead.checkin; d < lead.checkout; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) {
    const q = disponibilidade(hotel, reservas, leads, d, bloqueios).find((x) => x.id === lead.quarto_id);
    if (!q || q.livres < 1) return false;
  }
  return true;
}

const linkPagamento = (base, leadId) => `${base}/pagamento?lead=${encodeURIComponent(leadId)}`;
const br = (d) => d.split("-").reverse().join("/");
const reais = (v) => dinheiro(v, carregarHotel());

// Confirma a reserva depois do pagamento aprovado e avisa o hóspede por e-mail
const pessoas = (r) => `${r.adultos} adulto${r.adultos > 1 ? "s" : ""}${r.criancas ? ` e ${r.criancas} criança${r.criancas > 1 ? "s" : ""}` : ""}`;
const avisoTeste = (pag) => (pag?.provedor === "getnet" && getnet.configGetnet()?.ambiente === "producao" ? "" : "\n\n(Ambiente de testes: nenhum valor foi cobrado de verdade.)");

// E-mails ao hóspede sobre o pagamento: pix pago, cartão pré-autorizado, capturado ou liberado
export async function emailPagamento(hotel, lead, pag, evento) {
  if (!pag.email) return;
  const r = resumoPedido(hotel, lead);
  const cartao = `cartão ${pag.cartao_bandeira ?? ""} final ${pag.cartao_final ?? ""}`.replace(/\s+/g, " ");
  const m = {
    pago: [`Pagamento confirmado – reserva ${pag.codigo_reserva}`, `Recebemos seu pagamento de ${reais(r.total)} por Pix.`],
    pre_autorizado: [`Pré-autorização aprovada – reserva ${pag.codigo_reserva}`,
      `A pré-autorização de ${reais(r.total)} no ${cartao} foi aprovada. O valor fica reservado no limite do cartão e será cobrado pelo hotel; você receberá outro e-mail quando isso acontecer.`],
    capturado: [`Pagamento confirmado – reserva ${pag.codigo_reserva}`, `O valor de ${reais(r.total)} foi cobrado no ${cartao}. Pagamento concluído.`],
    liberado: [`Reserva ${pag.codigo_reserva} cancelada – pré-autorização liberada`,
      `Sua reserva foi cancelada e a pré-autorização de ${reais(r.total)} no ${cartao} foi liberada. Nada foi cobrado.`],
  }[evento];
  if (!m) return;
  await enviarEmail({
    para: pag.email, tipo: `pagamento_${evento}`, leadId: lead.id, assunto: `${m[0]} – ${hotel.nome}`,
    texto: `Olá, ${pag.nome}!\n\n${m[1]}\n\nCódigo da reserva: ${pag.codigo_reserva}\nValor: ${reais(r.total)}\n\n${hotel.nome}${avisoTeste(pag)}`,
  });
}

// E-mail com os dados da reserva confirmada e o link do pré-check-in
async function emailReserva(hotel, lead, pag, ck, base) {
  if (!pag.email) return;
  const r = resumoPedido(hotel, lead);
  await enviarEmail({
    para: pag.email, tipo: "reserva_confirmada", leadId: lead.id,
    assunto: `Reserva ${pag.codigo_reserva} confirmada – ${hotel.nome}`,
    texto: `Olá, ${pag.nome}!\n\nSua reserva está confirmada.\n\nCódigo: ${pag.codigo_reserva}\nQuarto: ${r.quarto}\nEntrada: ${br(r.checkin)}, a partir das ${hotel.checkin}\nSaída: ${br(r.checkout)}, até as ${hotel.checkout}\n${r.noites} noite${r.noites > 1 ? "s" : ""}, ${pessoas(r)}\nTotal: ${reais(r.total)}\n\n${ck ? `${textoLinkGuia(base, ck.token, hotel.guia?.marca ?? hotel.nome)}\n\n` : ""}${hotel.politicas}\n\nAté breve!\n${hotel.nome}${avisoTeste(pag)}`,
  });
}

// Quem reservou pelo WhatsApp recebe o link do guia na mesma conversa (dentro da janela de 24 horas dela)
async function whatsappReserva(hotel, lead, pag, ck, base) {
  if (!ck || !String(lead.conversa_id ?? "").startsWith("wa:")) return;
  const texto = `Reserva ${pag.codigo_reserva} confirmada, ${String(pag.nome ?? "").split(" ")[0]}! 🎉\n\n${textoLinkGuia(base, ck.token, hotel.guia?.marca ?? hotel.nome)}`;
  await enviarWhatsapp(lead.conversa_id.slice(3), { type: "text", text: { body: texto, preview_url: true } });
}

// Confirma a reserva depois do pagamento aprovado e manda os dois e-mails: pagamento e reserva
export async function confirmar(hotel, lead, pag, campos, base) {
  const codigo = pag.codigo_reserva || `P-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const r = resumoPedido(hotel, lead);
  await salvarReserva({
    codigo_motor: codigo, lead_id: lead.id, quarto_id: lead.quarto_id, checkin: lead.checkin, checkout: lead.checkout,
    hospede: pag.nome, valor: r.total, status: "confirmada",
  });
  const salvo = await salvarPagamento({ ...pag, ...campos, codigo_reserva: codigo, pago_em: new Date().toISOString() });
  // Antes da migração 007 não há tabela de check-in: a reserva segue sem o link
  const ck = await garantirCheckin(codigo).catch((err) => { console.error("check-in:", err.message); return null; });
  await emailPagamento(hotel, lead, salvo, salvo.status);
  await emailReserva(hotel, lead, salvo, ck, base);
  await whatsappReserva(hotel, lead, salvo, ck, base).catch((err) => console.error("WhatsApp da reserva:", err.message));
  // Conversão para a Meta (o navegador manda a mesma com o Pixel; o event_id evita contar duas vezes)
  await enviarMeta({ evento: "Purchase", eventId: codigo, leadId: lead.id, valor: r.total, pessoa: salvo, url: `${base}/pagamento` })
    .catch((err) => console.error("Meta:", err.message));
  return { ...salvo, link_checkin: ck ? linkCheckin(base, ck.token) : null, link_guia: ck ? linkGuia(base, ck.token) : null };
}

// Envia o e-mail com o link de pagamento para quem não pagou em MINUTOS_LEMBRETE minutos
export async function enviarLembretes(baseUrl, agora = new Date()) {
  const hotel = carregarHotel();
  const pendentes = await pagamentosSemLembrete(MINUTOS_LEMBRETE, agora);
  let enviados = 0;
  for (const p of pendentes) {
    const lead = await buscarLead(p.lead_id);
    if (!lead || lead.checkin < agora.toISOString().slice(0, 10)) {
      await salvarPagamento({ ...p, lembrete_em: agora.toISOString() });
      continue;
    }
    const r = resumoPedido(hotel, lead);
    // Marca antes de enviar, para não mandar duas vezes se duas execuções coincidirem
    await salvarPagamento({ ...p, lembrete_em: agora.toISOString() });
    await enviarEmail({
      para: p.email, tipo: "lembrete_pagamento", leadId: lead.id,
      assunto: `Sua reserva no ${hotel.nome} está esperando o pagamento`,
      texto: `Olá, ${p.nome || ""}!\n\nVocê começou a reservar e o pagamento ainda não foi concluído:\n\n${r.quarto}, de ${br(r.checkin)} a ${br(r.checkout)} (${r.noites} noites) – ${reais(r.total)}.\n\nPara garantir o quarto, finalize aqui:\n${linkPagamento(baseUrl, lead.id)}\n\n${hotel.nome}`,
    });
    enviados++;
  }
  return { verificados: pendentes.length, enviados };
}

const urlBase = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

const rota = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Falha no pagamento. Tente de novo." });
  }
};

export const pagamento = express.Router();

// O link de pagamento já diz o hotel: cada lead é de um hotel só
pagamento.param("lead", async (req, res, next, id) => {
  try {
    const hotel = await localizarHotel("leads", "id", id);
    if (!hotel) return next();
    await noHotel(hotel, () => next());
  } catch (err) {
    next(err);
  }
});

// Carrega o lead e o pagamento; responde 404/409 se não der para pagar
async function carregar(req, res) {
  const lead = await buscarLead(req.params.lead);
  if (!lead) { res.status(404).json({ erro: "Reserva não encontrada. Peça um novo link no chat." }); return null; }
  const pag = await buscarPagamento(lead.id);
  return { lead, pag, hotel: carregarHotel() };
}

pagamento.get("/:lead", rota(async (req, res) => {
  const c = await carregar(req, res);
  if (!c) return;
  const { lead, pag, hotel } = c;
  const p = pag && { status: pag.status, metodo: pag.metodo, nome: pag.nome, email: pag.email, codigo_reserva: pag.codigo_reserva, cartao_final: pag.cartao_final, cartao_bandeira: pag.cartao_bandeira };
  // O link do pré-check-in aparece na tela quando a confirmação chega pela notificação da Getnet
  const ck = pag?.codigo_reserva && FINAIS.has(pag.status) ? await garantirCheckin(pag.codigo_reserva).catch(() => null) : null;
  if (p && ck) { p.link_checkin = linkCheckin(urlBase(req), ck.token); p.link_guia = linkGuia(urlBase(req), ck.token); }
  res.json({ pedido: resumoPedido(hotel, lead), pagamento: p ?? null, provedor: getnet.modoPagamento(), ambiente: getnet.configGetnet()?.ambiente ?? null, whatsapp: hotel.guia?.contato?.whatsapp ?? hotel.whatsapp ?? null, expirado: lead.checkin < new Date().toISOString().slice(0, 10) });
}));

// Passo 1: dados do hóspede. Começa a contar os minutos para o lembrete por e-mail.
pagamento.post("/:lead/dados", rota(async (req, res) => {
  const c = await carregar(req, res);
  if (!c) return;
  const nome = String(req.body?.nome ?? "").trim().slice(0, 120);
  const email = normalizarEmail(req.body?.email);
  const telefone = String(req.body?.telefone ?? "").replace(/[^\d+]/g, "").slice(0, 20) || null;
  if (!nome) return res.status(400).json({ erro: "Informe seu nome." });
  if (!emailValido(email)) return res.status(400).json({ erro: "E-mail inválido." });
  if (c.pag && FINAIS.has(c.pag.status)) return res.status(409).json({ erro: "Esta reserva já foi paga." });
  const pag = await salvarPagamento({ lead_id: c.lead.id, nome, email, telefone, status: "pendente", iniciado_em: c.pag?.iniciado_em ?? new Date().toISOString(), valor: resumoPedido(c.hotel, c.lead).total });
  await enviarMeta({ evento: "InitiateCheckout", eventId: `ic-${c.lead.id}`, leadId: c.lead.id, valor: pag.valor, pessoa: { nome, email, telefone }, url: `${urlBase(req)}/pagamento` })
    .catch((err) => console.error("Meta:", err.message));
  res.json({ ok: true, status: pag.status });
}));

async function prontoParaPagar(c, res) {
  if (getnet.modoPagamento() === "indisponivel") { res.status(503).json({ erro: "O pagamento online ainda não está disponível. Fale com o hotel pelo WhatsApp para concluir a reserva." }); return false; }
  if (!c.pag?.email) { res.status(400).json({ erro: "Preencha seus dados primeiro." }); return false; }
  if (FINAIS.has(c.pag.status)) { res.status(409).json({ erro: "Esta reserva já foi paga." }); return false; }
  if (c.lead.checkin < new Date().toISOString().slice(0, 10)) { res.status(410).json({ erro: "As datas deste link já passaram. Peça um novo no chat." }); return false; }
  if (!(await temVaga(c.hotel, c.lead))) { res.status(409).json({ erro: "Não há mais quartos livres nessas datas. Fale com o hotel pelo chat." }); return false; }
  return true;
}

// Cartão (simulado): pré-autoriza o valor total (fica retido até o hotel capturar ou liberar)
pagamento.post("/:lead/cartao", rota(async (req, res) => {
  const c = await carregar(req, res);
  if (!c || !(await prontoParaPagar(c, res))) return;
  // Com a Getnet o número do cartão nunca chega aqui: ele é digitado no checkout da própria Getnet
  if (getnet.configGetnet()) return res.status(400).json({ erro: "Use o formulário seguro do cartão." });
  const v = validarCartao(req.body ?? {});
  if (!v.ok) {
    if (v.recusado) await salvarPagamento({ ...c.pag, metodo: "cartao", status: "pendente" });
    return res.status(402).json({ erro: v.erro });
  }
  const pag = await confirmar(c.hotel, c.lead, c.pag, {
    metodo: "cartao", status: "pre_autorizado", provedor: "simulado", cartao_final: v.final, cartao_bandeira: v.bandeira,
    autorizacao: crypto.randomBytes(3).toString("hex").toUpperCase(),
  }, urlBase(req));
  res.json({ ok: true, status: pag.status, codigo_reserva: pag.codigo_reserva, link_checkin: pag.link_checkin, link_guia: pag.link_guia });
}));

// Cartão (Getnet): devolve os dados para a página abrir o Checkout Iframe da Getnet
pagamento.post("/:lead/cartao/getnet", rota(async (req, res) => {
  const c = await carregar(req, res);
  if (!c || !(await prontoParaPagar(c, res))) return;
  const cfg = getnet.configGetnet();
  if (!cfg) return res.status(400).json({ erro: "Pagamento com cartão indisponível." });
  const r = resumoPedido(c.hotel, c.lead);
  await salvarPagamento({ ...c.pag, metodo: "cartao", provedor: "getnet" });
  res.json(await getnet.configIframe({ pedidoId: c.lead.id, valor: r.total, pag: c.pag, hotel: c.hotel, descricao: `${r.quarto} ${br(r.checkin)} a ${br(r.checkout)}` }, cfg));
}));

// Pix: gera a cobrança (Getnet ou simulada)
pagamento.post("/:lead/pix", rota(async (req, res) => {
  const c = await carregar(req, res);
  if (!c || !(await prontoParaPagar(c, res))) return;
  const valor = resumoPedido(c.hotel, c.lead).total;
  const cfg = getnet.configGetnet();
  if (cfg) {
    // Reaproveita o QR Code enquanto ele vale (com 2 minutos de folga)
    const p = c.pag;
    if (p.provedor === "getnet" && p.metodo === "pix" && p.pix_copia_cola && p.pix_expira_em && Date.parse(p.pix_expira_em) - Date.now() > 120_000) {
      return res.json({ txid: p.gateway_id, valor, copia_e_cola: p.pix_copia_cola, expira_em_min: Math.floor((Date.parse(p.pix_expira_em) - Date.now()) / 60_000), real: true });
    }
    const tentativa = (p.tentativas_pix ?? 0) + 1;
    let pix;
    try {
      pix = await getnet.criarPix({ pedidoId: c.lead.id, valor, clienteId: p.email, tentativa }, cfg);
    } catch (err) {
      console.error(err.message);
      return res.status(502).json({ erro: "Não foi possível gerar o Pix agora. Tente de novo em instantes." });
    }
    const expira = pix.expiraEm && !Number.isNaN(Date.parse(pix.expiraEm)) ? new Date(pix.expiraEm) : new Date(Date.now() + 30 * 60_000);
    await salvarPagamento({ ...p, metodo: "pix", provedor: "getnet", gateway_id: pix.paymentId, pix_txid: pix.paymentId, pix_copia_cola: pix.copiaECola, pix_expira_em: expira.toISOString(), tentativas_pix: tentativa, gateway_status: pix.status ?? null });
    return res.json({ txid: pix.paymentId, valor, copia_e_cola: pix.copiaECola, expira_em_min: Math.max(1, Math.floor((expira - Date.now()) / 60_000)), real: true });
  }
  const txid = c.pag.pix_txid || `SIM${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  await salvarPagamento({ ...c.pag, metodo: "pix", provedor: "simulado", pix_txid: txid });
  res.json({ txid, valor, copia_e_cola: pixFake(txid, valor, c.hotel), expira_em_min: 30 });
}));

// Pix: simula a confirmação do banco (só no checkout simulado)
pagamento.post("/:lead/pix/simular", rota(async (req, res) => {
  if (getnet.configGetnet()) return res.status(404).json({ erro: "Indisponível" });
  const c = await carregar(req, res);
  if (!c || !(await prontoParaPagar(c, res))) return;
  if (!c.pag.pix_txid) return res.status(400).json({ erro: "Gere o Pix primeiro." });
  const pag = await confirmar(c.hotel, c.lead, c.pag, { metodo: "pix", status: "pago" }, urlBase(req));
  res.json({ ok: true, status: pag.status, codigo_reserva: pag.codigo_reserva, link_checkin: pag.link_checkin, link_guia: pag.link_guia });
}));

// Notificação da Getnet (GET com os dados na query). A Getnet não assina a notificação, então:
// a URL tem um segredo, e vendedor, pedido e valor precisam bater com o que está no banco.
// Responde 200 sempre que a notificação foi entendida, para a Getnet não reenviar.
export async function tratarNotificacaoGetnet(query, base) {
  const cfg = getnet.configGetnet();
  const n = getnet.lerNotificacao(query);
  if (!cfg || !n.pedidoId) return { ok: false, motivo: "sem pedido" };
  if (n.sellerId && n.sellerId !== cfg.seller) return { ok: false, motivo: "vendedor diferente" };
  const lead = await buscarLead(n.pedidoId);
  const pag = lead && (await buscarPagamento(lead.id));
  if (!lead || !pag) return { ok: false, motivo: "pedido desconhecido" };
  const esperado = getnet.centavos(pag.valor ?? resumoPedido(carregarHotel(), lead).total);
  // Valor em centavos (padrão da API) ou em reais
  if (n.valor != null && n.valor !== esperado && getnet.centavos(n.valor) !== esperado) return { ok: false, motivo: "valor diferente" };
  if (pag.gateway_id && n.paymentId && n.metodo === "pix" && pag.gateway_id !== n.paymentId) return { ok: false, motivo: "pagamento diferente" };
  const hotel = carregarHotel();
  const registro = { provedor: "getnet", gateway_status: n.status, ...(n.paymentId ? { gateway_id: n.paymentId } : {}) };
  if (!n.novo || pag.status === n.novo) {
    await salvarPagamento({ ...pag, ...registro });
    return { ok: true, status: pag.status };
  }
  if (n.novo === "pago" || n.novo === "pre_autorizado") {
    if (FINAIS.has(pag.status)) return { ok: true, status: pag.status };
    const campos = { ...registro, metodo: n.metodo, status: n.novo, ...(n.metodo === "cartao" ? { cartao_bandeira: n.bandeira, autorizacao: n.autorizacao } : {}) };
    const salvo = await confirmar(hotel, lead, pag, campos, base);
    return { ok: true, status: salvo.status };
  }
  if (n.novo === "recusado") {
    if (!FINAIS.has(pag.status)) await salvarPagamento({ ...pag, ...registro, status: "pendente" });
    return { ok: true, status: "pendente" };
  }
  // Captura ou cancelamento feitos pelo painel da Getnet: só acompanha o status
  if (pag.status === "pre_autorizado" && ["capturado", "liberado"].includes(n.novo)) {
    const salvo = await salvarPagamento({ ...pag, ...registro, status: n.novo });
    await emailPagamento(hotel, lead, salvo, salvo.status);
    return { ok: true, status: n.novo };
  }
  await salvarPagamento({ ...pag, ...registro });
  return { ok: true, status: pag.status };
}

pagamento.get("/getnet/notificacao/:segredo", rota(async (req, res) => {
  // O pedido (order_id) é o lead, que diz de qual hotel é o pagamento
  const hotel = await localizarHotel("leads", "id", String(req.query.order_id ?? "")) ?? HOTEL_PADRAO;
  const r = await noHotel(hotel, async () => {
    if (!getnet.segredoConfere(req.params.segredo)) return null;
    return tratarNotificacaoGetnet(req.query, urlBase(req));
  });
  if (!r) return res.status(404).end();
  if (!r.ok) console.error("Getnet notificação ignorada:", r.motivo, req.query.order_id ?? "");
  res.status(200).json({ ok: r.ok });
}));

// Captura ou libera a pré-autorização na Getnet (chamado pelo back-office). Simulado: não faz nada.
export async function acaoGetnet(pag, acao) {
  if (pag.provedor !== "getnet") return null;
  if (!pag.gateway_id) throw new Error("Pagamento sem o id da Getnet");
  const args = { pedidoId: pag.lead_id, paymentId: pag.gateway_id, valor: pag.valor };
  return acao === "capturar" ? getnet.capturarCartao(args) : getnet.cancelarCartao(args);
}

// Tarefa agendada: lembretes por e-mail. Protegida por CRON_SECRET.
export async function rotaLembretes(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || (req.get("authorization") ?? "") !== `Bearer ${segredo}`) return res.status(401).json({ erro: "Não autorizado" });
  try {
    res.json(await enviarLembretes(urlBase(req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
}
