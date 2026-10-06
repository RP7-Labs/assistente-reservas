import crypto from "node:crypto";
import express from "express";
import { carregarHotel } from "./catalogo.js";
import { listarConversas, listarDados, marcarAtendente, salvarReserva, atualizarStatusReserva } from "./store.js";
import { montarLocacoes, disponibilidade, falas, resumoAtendimento, indicadores } from "./backoffice.js";

const STATUS_RESERVA = ["confirmada", "cancelada", "no_show", "concluida"];
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function hash(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

// Senha única do back-office, enviada no cabeçalho x-admin-senha
function exigirSenha(req, res, next) {
  const senha = process.env.ADMIN_PASSWORD;
  if (!senha) return res.status(503).json({ erro: "Back-office desativado: defina ADMIN_PASSWORD." });
  const enviada = req.get("x-admin-senha") ?? "";
  if (!crypto.timingSafeEqual(hash(enviada), hash(senha))) return res.status(401).json({ erro: "Senha incorreta" });
  next();
}

const rota = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
};

export const admin = express.Router();
admin.use(exigirSenha);

admin.get("/login", (_req, res) => res.json({ ok: true }));

admin.get("/painel", rota(async (_req, res) => {
  const [conversas, dados] = await Promise.all([listarConversas(), listarDados()]);
  const atendimentos = conversas.map(resumoAtendimento);
  const locacoes = montarLocacoes(dados.leads, dados.cliques, dados.reservas);
  res.json({ indicadores: indicadores(atendimentos, locacoes), atendimentos, locacoes, quartos: carregarHotel().quartos.map(({ id, nome }) => ({ id, nome })) });
}));

admin.get("/conversas/:id", rota(async (req, res) => {
  const c = (await listarConversas(1000)).find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ erro: "Conversa não encontrada" });
  res.json({ ...resumoAtendimento(c), falas: falas(c.mensagens) });
}));

admin.post("/conversas/:id/resolver", rota(async (req, res) => {
  await marcarAtendente(req.params.id, false, null);
  res.json({ ok: true });
}));

admin.get("/quartos", rota(async (req, res) => {
  const data = DATA_RE.test(req.query.data ?? "") ? req.query.data : new Date().toISOString().slice(0, 10);
  const { leads, reservas } = await listarDados();
  res.json({ data, quartos: disponibilidade(carregarHotel(), reservas, leads, data) });
}));

// Registra uma reserva: a partir de um link do assistente (lead_id) ou lançada à mão
admin.post("/reservas", rota(async (req, res) => {
  const b = req.body ?? {};
  const hotel = carregarHotel();
  let base = {};
  if (b.lead_id) {
    const lead = (await listarDados()).leads.find((l) => l.id === b.lead_id);
    if (!lead) return res.status(404).json({ erro: "Link não encontrado" });
    base = { lead_id: lead.id, quarto_id: lead.quarto_id, checkin: lead.checkin, checkout: lead.checkout };
  }
  const reserva = {
    codigo_motor: String(b.codigo_motor || `M-${crypto.randomBytes(3).toString("hex").toUpperCase()}`).trim(),
    lead_id: base.lead_id ?? null,
    quarto_id: b.quarto_id || base.quarto_id,
    checkin: b.checkin || base.checkin,
    checkout: b.checkout || base.checkout,
    hospede: b.hospede?.trim() || null,
    valor: b.valor === "" || b.valor == null ? null : Number(b.valor),
    status: b.status || "confirmada",
  };
  if (!hotel.quartos.some((q) => q.id === reserva.quarto_id)) return res.status(400).json({ erro: "Quarto inválido" });
  if (!DATA_RE.test(reserva.checkin ?? "") || !DATA_RE.test(reserva.checkout ?? "") || reserva.checkout <= reserva.checkin) {
    return res.status(400).json({ erro: "Datas inválidas" });
  }
  if (reserva.valor != null && !(reserva.valor >= 0)) return res.status(400).json({ erro: "Valor inválido" });
  if (!STATUS_RESERVA.includes(reserva.status)) return res.status(400).json({ erro: "Status inválido" });
  res.status(201).json(await salvarReserva(reserva));
}));

admin.patch("/reservas/:codigo", rota(async (req, res) => {
  const { status } = req.body ?? {};
  if (!STATUS_RESERVA.includes(status)) return res.status(400).json({ erro: "Status inválido" });
  const ok = await atualizarStatusReserva(req.params.codigo, status);
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { erro: "Reserva não encontrada" });
}));
