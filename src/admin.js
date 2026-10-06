import crypto from "node:crypto";
import express from "express";
import { gerarHash, conferirSenha, criarToken, lerToken, normalizarEmail, emailValido } from "./auth.js";
import { carregarHotel } from "./catalogo.js";
import {
  listarConversas, listarDados, marcarAtendente, salvarReserva, atualizarStatusReserva,
  buscarAdmin, buscarAdminPorEmail, listarAdmins, criarAdmin, atualizarAdmin,
} from "./store.js";
import { montarLocacoes, disponibilidade, falas, resumoAtendimento, indicadores } from "./backoffice.js";

const STATUS_RESERVA = ["confirmada", "cancelada", "no_show", "concluida"];
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

// A conta do ADMIN_EMAIL é a principal: sempre aprovada e nunca pode ser desativada
const principal = () => normalizarEmail(process.env.ADMIN_EMAIL);
const ehPrincipal = (a) => Boolean(principal()) && a?.email === principal();
const aprovado = (a) => a?.status === "aprovado" || ehPrincipal(a);

// Sessão: token assinado no cabeçalho Authorization: Bearer <token>.
// A cada requisição confere se o admin ainda está aprovado, então revogar vale na hora.
async function exigirLogin(req, res, next) {
  try {
    const sessao = lerToken((req.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    const admin = sessao && (await buscarAdmin(sessao.id));
    if (!admin || !aprovado(admin)) return res.status(401).json({ erro: "Sessão expirada. Entre novamente." });
    req.admin = admin;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
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

const publico = (a) => ({ id: a.id, nome: a.nome, email: a.email, status: aprovado(a) ? "aprovado" : a.status, principal: ehPrincipal(a) });

// Pedido de acesso. O e-mail em ADMIN_EMAIL é aprovado direto.
admin.post("/cadastro", rota(async (req, res) => {
  const nome = String(req.body?.nome ?? "").trim();
  const email = normalizarEmail(req.body?.email);
  const senha = String(req.body?.senha ?? "");
  if (!nome) return res.status(400).json({ erro: "Informe o nome." });
  if (!emailValido(email)) return res.status(400).json({ erro: "E-mail inválido." });
  if (senha.length < 8) return res.status(400).json({ erro: "A senha precisa ter pelo menos 8 caracteres." });
  if (await buscarAdminPorEmail(email)) return res.status(409).json({ erro: "Este e-mail já tem cadastro." });

  const automatico = ehPrincipal({ email });
  const novo = await criarAdmin({
    nome, email, senha_hash: await gerarHash(senha),
    status: automatico ? "aprovado" : "pendente",
    aprovado_em: automatico ? new Date().toISOString() : null,
  });
  res.status(201).json({ status: novo.status });
}));

admin.post("/entrar", rota(async (req, res) => {
  const email = normalizarEmail(req.body?.email);
  const a = await buscarAdminPorEmail(email);
  const ok = a && (await conferirSenha(String(req.body?.senha ?? ""), a.senha_hash));
  if (!ok) return res.status(401).json({ erro: "E-mail ou senha incorretos." });
  if (!aprovado(a) && a.status === "pendente") return res.status(403).json({ erro: "Seu acesso ainda está aguardando aprovação de um admin." });
  if (!aprovado(a)) return res.status(403).json({ erro: "Seu acesso não está liberado." });
  res.json({ token: criarToken(a.id), admin: publico(a) });
}));

admin.use(exigirLogin);

admin.get("/eu", (req, res) => res.json(publico(req.admin)));

admin.get("/usuarios", rota(async (_req, res) => {
  const todos = await listarAdmins();
  const nomes = Object.fromEntries(todos.map((a) => [a.id, a.nome]));
  res.json(todos.map((a) => ({ ...a, ...publico(a), aprovado_por_nome: a.aprovado_por ? nomes[a.aprovado_por] ?? null : null })));
}));

admin.post("/usuarios/:id/:acao", rota(async (req, res) => {
  const { id, acao } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ erro: "Usuário não encontrado." });
  const alvo = await buscarAdmin(id);
  if (!alvo) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (acao === "aprovar") {
    await atualizarAdmin(id, { status: "aprovado", aprovado_por: req.admin.id, aprovado_em: new Date().toISOString() });
  } else if (acao === "recusar" || acao === "revogar") {
    if (ehPrincipal(alvo)) return res.status(403).json({ erro: "O admin principal não pode ser desativado." });
    if (id === req.admin.id) return res.status(400).json({ erro: "Você não pode revogar o próprio acesso." });
    await atualizarAdmin(id, { status: "recusado" });
  } else {
    return res.status(400).json({ erro: "Ação inválida." });
  }
  res.json({ ok: true });
}));

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
