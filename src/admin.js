import crypto from "node:crypto";
import express from "express";
import { gerarHash, conferirSenha, criarToken, lerToken, normalizarEmail, emailValido } from "./auth.js";
import { carregarHotel, noHotel, prepararHotel, limparCacheHoteis } from "./catalogo.js";
import { hotelId, HOTEL_PADRAO, SLUG_RE, simulacaoPermitida } from "./tenant.js";
import { PAISES } from "./paises.js";
import {
  listarConversas, listarDados, marcarAtendente, salvarReserva, atualizarStatusReserva,
  buscarAdmin, buscarAdminPorEmail, listarAdmins, criarAdmin, atualizarAdmin,
  listarPagamentos, buscarPagamento, salvarPagamento, listarEmails, buscarLead,
  listarCanais, listarBloqueios, salvarCanal, removerCanal,
  listarUnidades, salvarUnidade, removerUnidade, listarCheckins, buscarCheckin, buscarReserva,
  listarOrigens, listarConversoes, listarConversasResumo, listarVisitas,
} from "./store.js";
import { novoToken, urlValida } from "./ical.js";
import { garantirCheckin, entregarSenha, revogarSenha, OPCOES_FICHA, ENTRADA } from "./checkin.js";
import { linkGuia, textoLinkGuia } from "./guia.js";
import { modoFechaduras, configTTLock, listarFechadurasTTLock } from "./fechaduras.js";
import { modoFNRH, registrarFicha, eventoFNRH } from "./fnrh.js";
import { fonte, csvGoogleAds, configMeta, configPublica } from "./rastreio.js";
import { sincronizarCanal, sincronizarCanais, bloqueiosOuNada, MINUTOS_SYNC } from "./canais.js";
import { modoEmail, enviarEmail } from "./email.js";
import { emailPagamento, acaoGetnet } from "./pagamento.js";
import { receberLead, contatarLead, modoLeadsMeta } from "./leadsMeta.js";
import { listarLeadsMeta, buscarLeadMeta, listarHoteis, buscarHotelRegistro, salvarHotelRegistro, localizarHotel, registrarAuditoria, listarProvas, verificarProvas } from "./store.js";
import { montarLocacoes, disponibilidade, falas, resumoAtendimento, indicadores } from "./backoffice.js";
import { resultados } from "./rotasResultados.js";
import { testarIntegracao, TESTES } from "./integracoes.js";
import { pendenciasLegais, dadosEmpresa, provar, textoTermosReserva, textoPrivacidade, textoContratoTemporada, versao } from "./legal.js";

const STATUS_RESERVA = ["confirmada", "cancelada", "no_show", "concluida"];
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

// A conta do ADMIN_EMAIL é a principal: sempre aprovada e nunca pode ser desativada
const principal = () => normalizarEmail(process.env.ADMIN_EMAIL);
const ehPrincipal = (a) => Boolean(principal()) && a?.email === principal();
const aprovado = (a) => a?.status === "aprovado" || ehPrincipal(a);

// Sessão: token assinado no cabeçalho Authorization: Bearer <token>.
// A cada requisição confere se o admin ainda está aprovado, então revogar vale na hora.
// O admin trabalha no hotel do token. Admin da plataforma (PLATAFORMA_EMAILS) pode abrir outro hotel com X-Hotel.
async function exigirLogin(req, res, next) {
  try {
    const sessao = lerToken((req.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    const hotelDoToken = sessao?.h ?? HOTEL_PADRAO;
    const admin = sessao && (await noHotel(hotelDoToken, () => buscarAdmin(sessao.id)));
    if (!admin || !aprovado(admin)) return res.status(401).json({ erro: "Sessão expirada. Entre novamente." });
    req.admin = admin;
    req.admin.plataforma = ehPlataforma(admin);
    const pedido = String(req.get("x-hotel") ?? "").trim().toLowerCase();
    let hotel = hotelDoToken;
    if (pedido && pedido !== hotelDoToken) {
      if (!req.admin.plataforma) return res.status(403).json({ erro: "Sem acesso a este hotel." });
      if (!SLUG_RE.test(pedido) || !(await prepararHotel(pedido))) return res.status(404).json({ erro: "Hotel não encontrado" });
      hotel = pedido;
    }
    req.hotelId = hotel;
    await noHotel(hotel, () => next());
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: err.message });
  }
}

// Admins da plataforma (donos do produto): criam hotéis e entram em qualquer um
const ehPlataforma = (a) => String(process.env.PLATAFORMA_EMAILS ?? process.env.ADMIN_EMAIL ?? "").split(",").map(normalizarEmail).filter(Boolean).includes(a?.email);

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
  if (await localizarHotel("admins", "email", email)) return res.status(409).json({ erro: "Este e-mail já tem cadastro." });

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
  // O e-mail é único na plataforma: ele diz de qual hotel é o admin
  const hotel = (await localizarHotel("admins", "email", email)) ?? hotelId();
  const a = await noHotel(hotel, () => buscarAdminPorEmail(email));
  const ok = a && (await conferirSenha(String(req.body?.senha ?? ""), a.senha_hash));
  if (!ok) return res.status(401).json({ erro: "E-mail ou senha incorretos." });
  if (!aprovado(a) && a.status === "pendente") return res.status(403).json({ erro: "Seu acesso ainda está aguardando aprovação de um admin." });
  if (!aprovado(a)) return res.status(403).json({ erro: "Seu acesso não está liberado." });
  res.json({ token: criarToken(a.id, Date.now(), hotel), admin: publico(a) });
}));

admin.use(exigirLogin);

admin.get("/eu", (req, res) => {
  const h = carregarHotel();
  res.json({ ...publico(req.admin), plataforma: req.admin.plataforma, hotel: { id: h.id, nome: h.nome, pais: h.pais, idioma: h.idioma, moeda: h.moeda, fuso: h.fuso } });
});

// ---- Hotéis da plataforma (só admins da plataforma) ----

const soPlataforma = (req, res, next) => (req.admin.plataforma ? next() : res.status(403).json({ erro: "Só para admins da plataforma." }));

admin.get("/hoteis", soPlataforma, rota(async (_req, res) => {
  const cadastrados = await listarHoteis();
  const ids = new Set(cadastrados.map((h) => h.id));
  const lista = ids.has(HOTEL_PADRAO) ? cadastrados : [{ id: HOTEL_PADRAO, nome: (await noHotel(HOTEL_PADRAO, () => carregarHotel())).nome, pais: "BR", ativo: true, dominios: [], config: {} }, ...cadastrados];
  res.json({ hoteis: lista.map(({ config, ...h }) => ({ ...h, quartos: config?.quartos?.length ?? null })), paises: Object.fromEntries(Object.entries(PAISES).map(([k, p]) => [k, p.nome])) });
}));

// Cria ou atualiza um hotel. O primeiro admin do hotel novo pede acesso pela tela de login com ?hotel=<id>.
admin.post("/hoteis", soPlataforma, rota(async (req, res) => {
  const b = req.body ?? {};
  const id = String(b.id ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(id)) return res.status(400).json({ erro: "Id do hotel: letras minúsculas, números e hífen (2 a 40)." });
  const nome = String(b.nome ?? "").trim().slice(0, 120);
  if (!nome) return res.status(400).json({ erro: "Informe o nome do hotel." });
  const pais = String(b.pais ?? "BR").toUpperCase();
  if (!PAISES[pais]) return res.status(400).json({ erro: "País não atendido." });
  const atual = await buscarHotelRegistro(id);
  const dominios = String(b.dominios ?? "").split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const config = { ...(atual?.config ?? {}), ...(b.cidade ? { cidade: String(b.cidade).slice(0, 80) } : {}) };
  const salvo = await salvarHotelRegistro({ id, nome, pais, idioma: b.idioma || null, moeda: b.moeda || null, fuso: b.fuso || null, dominios, config, ativo: b.ativo !== false });
  limparCacheHoteis();
  res.status(atual ? 200 : 201).json(salvo);
}));

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
  const [conversas, dados, pagamentos] = await Promise.all([listarConversas(), listarDados(),
    // Antes de rodar db/004_pagamentos.sql a tabela não existe; o painel segue funcionando
    listarPagamentos().catch(() => [])]);
  const atendimentos = conversas.map(resumoAtendimento);
  const locacoes = montarLocacoes(dados.leads, dados.cliques, dados.reservas, undefined, pagamentos);
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
  const [{ leads, reservas }, bloqueios] = await Promise.all([listarDados(), bloqueiosOuNada()]);
  res.json({ data, quartos: disponibilidade(carregarHotel(), reservas, leads, data, bloqueios) });
}));

// Testa a conexão com cada integração (chamada real, sem cobrar, enviar ou gravar nada)
admin.post("/integracoes/:nome/testar", rota(async (req, res) => {
  if (!TESTES[req.params.nome]) return res.status(404).json({ erro: "Integração desconhecida." });
  const r = await testarIntegracao(req.params.nome);
  await registrarAuditoria(req.admin.email, `testou integração ${req.params.nome}`, { ok: r.ok, detalhe: r.detalhe }).catch(() => {});
  res.json(r);
}));

// ---- Catálogo e preços: o que o assistente oferece e cobra. Fica no cadastro do hotel (sobrepõe data/hotel.json). ----

const CAMPOS_QUARTO = ["id", "nome", "descricao", "apelidos", "capacidade_adultos", "capacidade_total", "unidades", "preco_a_partir", "preco_mensal", "minimo_noites_mensal", "codigo_motor"];
const MOTOR_RE = /^https:\/\/[^\s]+\{checkin\}[^\s]*$/;

export function validarCatalogo(b) {
  if (!Array.isArray(b?.quartos) || !b.quartos.length || b.quartos.length > 30) return { erro: "Cadastre de 1 a 30 tipos de quarto." };
  const ids = new Set();
  const quartos = [];
  for (const [i, q] of b.quartos.entries()) {
    const n = `Quarto ${i + 1}`;
    const id = String(q.id ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(id) || id === ENTRADA) return { erro: `${n}: código inválido (letras minúsculas, números, - ou _).` };
    if (ids.has(id)) return { erro: `${n}: código "${id}" repetido.` };
    ids.add(id);
    const nome = String(q.nome ?? "").trim().slice(0, 60);
    if (!nome) return { erro: `${n}: informe o nome.` };
    const inteiro = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
    if (!inteiro(q.capacidade_adultos, 1, 20) || !inteiro(q.capacidade_total, 1, 20) || Number(q.capacidade_total) < Number(q.capacidade_adultos)) return { erro: `${nome}: capacidade inválida.` };
    if (!inteiro(q.unidades, 0, 1000)) return { erro: `${nome}: quantidade de unidades inválida.` };
    const preco = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
    const diaria = preco(q.preco_a_partir), mensal = preco(q.preco_mensal);
    for (const [rot, v] of [["diária", diaria], ["preço mensal", mensal]]) if (v !== null && !(Number.isFinite(v) && v > 0 && v < 1_000_000)) return { erro: `${nome}: ${rot} inválido.` };
    quartos.push({
      id, nome, descricao: String(q.descricao ?? "").trim().slice(0, 400),
      apelidos: (Array.isArray(q.apelidos) ? q.apelidos : String(q.apelidos ?? "").split(",")).map((a) => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 15),
      capacidade_adultos: Number(q.capacidade_adultos), capacidade_total: Number(q.capacidade_total), unidades: Number(q.unidades),
      preco_a_partir: diaria, preco_mensal: mensal, minimo_noites_mensal: inteiro(q.minimo_noites_mensal, 7, 365) ? Number(q.minimo_noites_mensal) : 28,
      codigo_motor: String(q.codigo_motor ?? "").trim().slice(0, 40),
    });
  }
  const link = String(b.link_motor ?? "").trim();
  if (link && !MOTOR_RE.test(link)) return { erro: "Link do motor: precisa começar com https:// e ter {checkin}." };
  return { quartos, politicas: String(b.politicas ?? "").trim().slice(0, 800), motor: { link_modelo: link } };
}

// Grava um trecho da configuração do hotel no cadastro (tabela hoteis) e registra na auditoria
async function salvarConfigHotel(req, campos, acao) {
  const id = hotelId();
  const atual = await buscarHotelRegistro(id);
  const h = carregarHotel();
  const antes = Object.fromEntries(Object.keys(campos).map((k) => [k, h[k] ?? null]));
  await salvarHotelRegistro({ ...(atual ?? { id, nome: h.nome, pais: h.pais ?? "BR", dominios: [], ativo: true }), id, config: { ...(atual?.config ?? {}), ...campos } });
  limparCacheHoteis();
  await prepararHotel(id);
  await registrarAuditoria(req.admin.email, acao, { antes, depois: campos }).catch((err) => console.error("Auditoria:", err.message));
}

// Quando a senha da porta é enviada: na hora do pré-check-in ou X horas antes do horário de check-in
admin.put("/senha-envio", rota(async (req, res) => {
  const modo = req.body?.modo === "antes_checkin" ? "antes_checkin" : "imediato";
  const horas = Number(req.body?.horas_antes);
  if (modo === "antes_checkin" && !(Number.isInteger(horas) && horas >= 0 && horas <= 168)) return res.status(400).json({ erro: "Horas antes do check-in: de 0 a 168." });
  const senha_envio = modo === "imediato" ? { modo } : { modo, horas_antes: horas };
  await salvarConfigHotel(req, { senha_envio }, "alterou envio da senha");
  res.json({ ok: true, senha_envio });
}));

admin.get("/catalogo", rota(async (_req, res) => {
  const h = carregarHotel();
  res.json({ quartos: h.quartos.map((q) => Object.fromEntries(CAMPOS_QUARTO.map((c) => [c, q[c] ?? null]))), politicas: h.politicas ?? "", link_motor: h.motor?.link_modelo ?? "" });
}));

// ---- Dados legais (vendedor, cancelamento, aluguel por temporada) e provas ----

const limpa = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max) || null;
export function validarLegal(b) {
  const tipo = b?.tipo === "temporada" ? "temporada" : "hotel";
  const e = b?.empresa ?? {};
  const doc = String(e.cnpj ?? "").replace(/\D/g, "");
  if (doc && doc.length !== 14 && doc.length !== 11) return { erro: "CNPJ (14 dígitos) ou CPF (11 dígitos)." };
  for (const em of [e.email, e.encarregado?.email]) if (em && !emailValido(normalizarEmail(em))) return { erro: `E-mail inválido: ${em}` };
  const empresa = {
    razao_social: limpa(e.razao_social, 150), cnpj: doc || null, endereco: limpa(e.endereco, 200),
    email: e.email ? normalizarEmail(e.email) : null, telefone: limpa(e.telefone, 30),
    encarregado: { nome: limpa(e.encarregado?.nome, 100), email: e.encarregado?.email ? normalizarEmail(e.encarregado.email) : null },
  };
  const cancelamento = String(b?.cancelamento ?? "").trim().slice(0, 1500) || null;
  const out = { tipo, empresa, cancelamento };
  if (tipo === "temporada") {
    const t = b?.temporada ?? {};
    const max = Number(t.max_ocupantes);
    if (t.max_ocupantes != null && t.max_ocupantes !== "" && !(Number.isInteger(max) && max >= 1 && max <= 50)) return { erro: "Máximo de ocupantes: de 1 a 50." };
    // Inventário: uma linha por item, "item; quantidade; estado"
    const linhas = Array.isArray(t.inventario) ? t.inventario : String(t.inventario ?? "").split("\n");
    const inventario = linhas.map((l) => (typeof l === "string" ? l.split(";").map((x) => x.trim()) : [l.item, l.quantidade, l.estado]))
      .filter(([item]) => item).slice(0, 200)
      .map(([item, qtd, estado]) => ({ item: String(item).slice(0, 120), quantidade: Number.parseInt(qtd, 10) || 1, estado: limpa(estado, 120) ?? "bom" }));
    out.temporada = {
      locador: { nome: limpa(t.locador?.nome, 150), documento: String(t.locador?.documento ?? "").replace(/\D/g, "") || null, endereco: limpa(t.locador?.endereco, 200) },
      imovel: { endereco: limpa(t.imovel?.endereco, 200), descricao: String(t.imovel?.descricao ?? "").trim().slice(0, 1000) || null },
      max_ocupantes: Number.isInteger(max) && max > 0 ? max : null,
      caucao: limpa(t.caucao, 300), regras: String(t.regras ?? "").trim().slice(0, 1500) || null, inventario,
    };
  }
  return out;
}

admin.get("/legal", rota(async (_req, res) => {
  const h = carregarHotel();
  const [provas, problema] = await Promise.all([listarProvas({ limite: 30 }).catch(() => null), verificarProvas().catch((err) => ({ erro: err.message }))]);
  res.json({
    tipo: h.tipo === "temporada" ? "temporada" : "hotel", empresa: dadosEmpresa(h), cancelamento: h.cancelamento ?? "", temporada: h.temporada ?? null,
    pendencias: pendenciasLegais(h), simulacao: simulacaoPermitida(),
    versoes: { privacidade: versao(textoPrivacidade(h)), termos: versao(textoTermosReserva(h)) },
    provas: provas?.map(({ id, tipo, referencia, titular, criado_em, ip, hash }) => ({ id, tipo, referencia, titular: titular?.nome ?? titular?.email ?? null, criado_em, ip, hash })) ?? null,
    corrente: problema?.erro ? { erro: problema.erro } : problema ? { ok: false, ...problema } : { ok: true },
  });
}));

admin.put("/legal", rota(async (req, res) => {
  const v = validarLegal(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  await salvarConfigHotel(req, v, "alterou dados legais");
  // O que o vendedor publicou também fica como prova (quem, quando e o texto exato)
  const h = carregarHotel();
  await provar(req, { tipo: "publicacao_termos", referencia: `admin:${req.admin.email}`, titular: { email: req.admin.email }, textoTipo: "termos_reserva", texto: textoTermosReserva(h) });
  if (h.tipo === "temporada") {
    const modelo = textoContratoTemporada(h, { reserva: { codigo_motor: "(modelo)", checkin: null, checkout: null }, valor: null, hospedes: [] });
    await provar(req, { tipo: "publicacao_contrato", referencia: `admin:${req.admin.email}`, titular: { email: req.admin.email }, textoTipo: "contrato_temporada_modelo", texto: modelo });
  }
  res.json({ ok: true, pendencias: pendenciasLegais(h) });
}));

// Pedido do titular (LGPD, art. 18): tudo o que o sistema guarda sobre a pessoa, por e-mail, CPF ou telefone
admin.get("/titular", rota(async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const digitos = q.replace(/\D/g, "");
  if (q.length < 5) return res.status(400).json({ erro: "Informe e-mail, CPF ou telefone." });
  const bate = (...vals) => vals.some((v) => {
    const s = String(v ?? "").toLowerCase();
    return s && (s === q || (digitos.length >= 8 && s.replace(/\D/g, "").endsWith(digitos)));
  });
  const [pagamentos, checkins, dados, leadsMeta] = await Promise.all([listarPagamentos(), listarCheckins(), listarDados(), listarLeadsMeta(5000).catch(() => [])]);
  const pags = pagamentos.filter((p) => bate(p.email, p.telefone));
  const cks = checkins.filter((c) => (c.hospedes ?? []).some((h) => bate(h.email, h.telefone, h.documento_numero)));
  const codigos = new Set([...pags.map((p) => p.codigo_reserva), ...cks.map((c) => c.codigo_reserva)].filter(Boolean));
  const leadIds = new Set(pags.map((p) => p.lead_id));
  const resultado = {
    gerado_em: new Date().toISOString(), busca: q, hotel: carregarHotel().nome,
    reservas: dados.reservas.filter((r) => codigos.has(r.codigo_motor)),
    pedidos: dados.leads.filter((l) => leadIds.has(l.id)),
    pagamentos: pags.map(({ pix_copia_cola, ...p }) => p),
    fichas: cks.map(({ token, senha, senhas_extra, ...c }) => ({ ...c, assinatura: c.assinatura ? { ...c.assinatura, imagem: c.assinatura.imagem ? "(imagem guardada)" : null } : null })),
    leads_meta: leadsMeta.filter((l) => bate(l.email, l.telefone)),
    provas: await listarProvas({ referencias: [...codigos, ...leadIds], limite: 500 }).catch(() => []),
  };
  await provar(req, { tipo: "direito_titular", referencia: q, titular: { email: q.includes("@") ? q : null }, dados: { pedido: "acesso", por: req.admin.email, encontrados: { reservas: resultado.reservas.length, fichas: resultado.fichas.length, pagamentos: resultado.pagamentos.length } } });
  res.json(resultado);
}));

admin.put("/catalogo", rota(async (req, res) => {
  const v = validarCatalogo(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  await salvarConfigHotel(req, v, "alterou catálogo e preços");
  res.json({ ok: true, ...v });
}));

// ---- Canais por iCal (Airbnb, Booking.com) ----

const urlExportar = (req, c) => `${(process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "")}/api/ical/${c.token_exportar}.ics`;

admin.get("/canais", rota(async (req, res) => {
  let canais, bloqueios, pendente = null;
  try {
    [canais, bloqueios] = await Promise.all([listarCanais(), listarBloqueios()]);
  } catch (err) {
    canais = []; bloqueios = [];
    pendente = `Rode a migração db/006_canais_ical.sql no Supabase (${err.message})`;
  }
  const hoje = new Date().toISOString().slice(0, 10);
  res.json({
    pendente,
    minutos_sync: MINUTOS_SYNC,
    quartos: carregarHotel().quartos.map((q) => ({ id: q.id, nome: q.nome, unidades: q.unidades })),
    canais: canais.map((c) => ({
      id: c.id, nome: c.nome, quarto_id: c.quarto_id, url_importar: c.url_importar, ultimo_sync: c.ultimo_sync, erro: c.erro,
      url_exportar: urlExportar(req, c),
      bloqueios: bloqueios.filter((b) => b.canal_id === c.id && b.checkout > hoje).map((b) => ({ checkin: b.checkin, checkout: b.checkout, resumo: b.resumo })),
    })),
  });
}));

admin.post("/canais", rota(async (req, res) => {
  const b = req.body ?? {};
  const nome = String(b.nome ?? "").trim().slice(0, 80);
  const url = String(b.url_importar ?? "").trim();
  if (!nome) return res.status(400).json({ erro: "Dê um nome ao canal, ex.: Airbnb · Suíte 1." });
  if (b.quarto_id !== ENTRADA && !carregarHotel().quartos.some((q) => q.id === b.quarto_id)) return res.status(400).json({ erro: "Escolha o tipo de quarto." });
  if (b.quarto_id === ENTRADA && !String(b.lock_id ?? "").trim()) return res.status(400).json({ erro: "Informe a fechadura da entrada." });
  if (url && !urlValida(url)) return res.status(400).json({ erro: "O link do calendário precisa começar com https://." });
  const canal = await salvarCanal({ id: crypto.randomBytes(5).toString("hex"), nome, quarto_id: b.quarto_id, url_importar: url || null, token_exportar: novoToken() });
  const sync = await sincronizarCanal(canal);
  res.json({ ok: true, id: canal.id, sync });
}));

admin.delete("/canais/:id", rota(async (req, res) => {
  await removerCanal(req.params.id);
  res.json({ ok: true });
}));

admin.post("/canais/sincronizar", rota(async (_req, res) => {
  res.json({ resultados: await sincronizarCanais({ forcar: true }) });
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
  // Reserva cancelada ou no-show perde a senha da porta
  if (ok && ["cancelada", "no_show"].includes(status)) {
    await revogarSenha(req.params.codigo).catch((err) => console.error(err));
    await eventoFNRH(req.params.codigo, status === "cancelada" ? "cancelar" : "noshow").catch((err) => console.error(err));
  }
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { erro: "Reserva não encontrada" });
}));

// Pagamentos do checkout simulado e e-mails enviados
admin.get("/pagamentos", rota(async (_req, res) => {
  const [pagamentos, emails] = await Promise.all([listarPagamentos(), listarEmails()]);
  res.json({ pagamentos, emails, modo_email: modoEmail() });
}));

// Pré-autorização do cartão: capturar (cobra) ou liberar (devolve o limite e cancela a reserva)
admin.post("/pagamentos/:lead/:acao", rota(async (req, res) => {
  const { acao } = req.params;
  if (!["capturar", "liberar"].includes(acao)) return res.status(400).json({ erro: "Ação inválida" });
  const pag = await buscarPagamento(req.params.lead);
  if (!pag) return res.status(404).json({ erro: "Pagamento não encontrado" });
  if (pag.status !== "pre_autorizado") return res.status(409).json({ erro: "Só pré-autorizações podem ser capturadas ou liberadas" });
  try {
    await acaoGetnet(pag, acao);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ erro: `A Getnet não aceitou: ${err.message}` });
  }
  const salvo = await salvarPagamento({ ...pag, status: acao === "capturar" ? "capturado" : "liberado" });
  if (acao === "liberar" && pag.codigo_reserva) {
    await atualizarStatusReserva(pag.codigo_reserva, "cancelada");
    await revogarSenha(pag.codigo_reserva).catch((err) => console.error(err));
    await eventoFNRH(pag.codigo_reserva, "cancelar").catch((err) => console.error(err));
  }
  const lead = await buscarLead(pag.lead_id);
  if (lead) await emailPagamento(carregarHotel(), lead, salvo, salvo.status);
  res.json({ ok: true });
}));

// Manda um e-mail de teste para o admin logado e devolve o erro do provedor, se houver
admin.post("/email-teste", rota(async (req, res) => {
  const r = await enviarEmail({
    para: req.admin.email, tipo: "teste", assunto: "Teste de e-mail – back-office de reservas",
    texto: `Olá, ${req.admin.nome}!\n\nSe você recebeu este e-mail, o envio está funcionando.`,
  });
  res.json({ ...r, para: req.admin.email, remetente: process.env.EMAIL_FROM || null });
}));

// ---- Check-in digital: unidades, fichas e senhas ----

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
const NOMES = OPCOES_FICHA;

admin.get("/checkins", rota(async (req, res) => {
  let unidades = [], checkins = [], pendente = null;
  try {
    [unidades, checkins] = await Promise.all([listarUnidades(), listarCheckins()]);
  } catch (err) {
    pendente = `Rode a migração db/007_checkin.sql no Supabase (${err.message})`;
  }
  const { reservas } = await listarDados();
  const hoje = new Date().toISOString().slice(0, 10);
  const porCodigo = new Map(checkins.map((c) => [c.codigo_reserva, c]));
  const lista = reservas
    .filter((r) => r.checkout >= hoje && ["confirmada", "concluida", "cancelada", "no_show"].includes(r.status))
    .sort((a, b) => a.checkin.localeCompare(b.checkin))
    .map((r) => {
      const c = porCodigo.get(r.codigo_motor);
      return {
        codigo: r.codigo_motor, quarto_id: r.quarto_id, checkin: r.checkin, checkout: r.checkout, hospede: r.hospede, status_reserva: r.status,
        status: c?.status ?? null, link: c ? linkGuia(baseUrl(req), c.token) : null, unidade: c?.unidade ?? null,
        chegada_prevista: c?.chegada_prevista ?? null, hospedes: c?.hospedes ?? null, concluido_em: c?.concluido_em ?? null,
        fnrh_status: c?.fnrh_status ?? null, fnrh_erro: c?.fnrh_erro ?? null, fnrh_entrada_em: c?.fnrh_entrada_em ?? null, fnrh_saida_em: c?.fnrh_saida_em ?? null,
        senha: c?.senha ?? null, senha_entrada: (c?.senhas_extra ?? []).map((x) => x.unidade ?? x.lock_id), senha_status: c?.senha_status ?? null, senha_erro: c?.senha_erro ?? null, senha_inicio: c?.senha_inicio ?? null, senha_fim: c?.senha_fim ?? null,
        senha_envio_em: c?.senha_envio_em ?? null, senha_aviso: c?.senha_aviso ?? null, assinatura: c?.assinatura ? { em: c.assinatura.em, hash: c.assinatura.hash } : null,
      };
    });
  res.json({ pendente, modo: modoFechaduras(), simulacao: simulacaoPermitida(), senha_envio: carregarHotel().senha_envio ?? { modo: "imediato" }, modo_fnrh: modoFNRH(), unidades, reservas: lista, nomes: NOMES, quartos: carregarHotel().quartos.map((q) => ({ id: q.id, nome: q.nome })) });
}));

// Cria (se preciso) o link do guia da estadia, que leva também ao pré-check-in; com enviar=true manda por e-mail para quem pagou
admin.post("/checkins/:codigo/link", rota(async (req, res) => {
  const reserva = await buscarReserva(req.params.codigo);
  if (!reserva) return res.status(404).json({ erro: "Reserva não encontrada" });
  const ck = await garantirCheckin(reserva.codigo_motor);
  const link = linkGuia(baseUrl(req), ck.token);
  let enviado = null;
  if (req.body?.enviar) {
    const pag = reserva.lead_id && (await buscarPagamento(reserva.lead_id));
    if (!pag?.email) return res.status(400).json({ erro: "Esta reserva não tem e-mail. Copie o link e mande pelo WhatsApp.", link });
    const hotel = carregarHotel();
    await enviarEmail({
      para: pag.email, tipo: "checkin_link", leadId: reserva.lead_id, assunto: `Guia da sua estadia e check-in online – ${hotel.guia?.marca ?? hotel.nome}`,
      texto: `Olá, ${(pag.nome || "").split(" ")[0]}!\n\n${textoLinkGuia(baseUrl(req), ck.token, hotel.guia?.marca ?? hotel.nome)}\n\n${hotel.guia?.marca ?? hotel.nome}`,
    });
    enviado = pag.email;
  }
  res.json({ link, enviado });
}));

admin.post("/checkins/:codigo/senha", rota(async (req, res) => {
  // Gera (ou troca) a senha e avisa o hóspede por e-mail e WhatsApp
  const ck = await entregarSenha(req.params.codigo);
  res.json({ ok: !["erro", "sem_unidade", "sem_fechadura"].includes(ck.senha_status), senha_status: ck.senha_status, erro: ck.senha_erro, aviso: ck.senha_aviso ?? null });
}));

// Assinatura do titular (imagem, data, hash e de onde assinou), para conferência ou disputa
admin.get("/checkins/:codigo/assinatura", rota(async (req, res) => {
  const c = await buscarCheckin({ codigo: req.params.codigo });
  if (!c?.assinatura) return res.status(404).json({ erro: "Sem assinatura." });
  res.set("Cache-Control", "no-store");
  res.json(c.assinatura);
}));

admin.delete("/checkins/:codigo/senha", rota(async (req, res) => {
  const ck = await revogarSenha(req.params.codigo);
  res.json({ ok: ck?.senha_status === "revogada", erro: ck?.senha_erro ?? null });
}));

// FNRH: reenviar a ficha, registrar entrada ou saída à mão
admin.post("/checkins/:codigo/fnrh/:evento", rota(async (req, res) => {
  const { codigo, evento } = req.params;
  if (!["registrar", "entrada", "saida"].includes(evento)) return res.status(400).json({ erro: "Ação inválida" });
  const ck = evento === "registrar" ? await registrarFicha(codigo) : await eventoFNRH(codigo, evento);
  if (!ck) return res.status(404).json({ erro: "Check-in não encontrado" });
  res.json({ ok: !ck.fnrh_erro, erro: ck.fnrh_erro ?? null });
}));

// Fechaduras da conta TTLock/TTHotel configurada, com a unidade que usa cada uma
admin.get("/fechaduras", rota(async (_req, res) => {
  const cfg = configTTLock();
  if (!cfg) return res.json({ modo: "simulado", fechaduras: [] });
  try {
    const [fechaduras, unidades] = await Promise.all([listarFechadurasTTLock(cfg), listarUnidades()]);
    const porLock = new Map(unidades.filter((u) => u.lock_id).map((u) => [String(u.lock_id), u.numero]));
    res.json({ modo: "ttlock", fechaduras: fechaduras.map((f) => ({ ...f, unidade: porLock.get(f.lock_id) ?? null })) });
  } catch (err) {
    res.json({ modo: "ttlock", fechaduras: [], erro: `Não consegui falar com a TTLock: ${err.message}` });
  }
}));

admin.post("/unidades", rota(async (req, res) => {
  const b = req.body ?? {};
  const numero = String(b.numero ?? "").trim().slice(0, 20);
  if (!numero) return res.status(400).json({ erro: "Informe o número da unidade." });
  if (b.quarto_id !== ENTRADA && !carregarHotel().quartos.some((q) => q.id === b.quarto_id)) return res.status(400).json({ erro: "Escolha o tipo de quarto." });
  if (b.quarto_id === ENTRADA && !String(b.lock_id ?? "").trim()) return res.status(400).json({ erro: "Informe a fechadura da entrada." });
  const lock = String(b.lock_id ?? "").trim();
  if (lock && !/^\d{1,15}$/.test(lock)) return res.status(400).json({ erro: "O ID da fechadura é o número que aparece no app TTLock (só dígitos)." });
  res.json(await salvarUnidade({ numero, quarto_id: b.quarto_id, lock_id: lock || null, ativa: b.ativa !== false }));
}));

admin.delete("/unidades/:numero", rota(async (req, res) => {
  await removerUnidade(req.params.numero);
  res.json({ ok: true });
}));

// ---- Campanhas: de onde vêm as conversas e quanto cada origem vendeu ----

async function dadosCampanhas(dias) {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const [conversas, origens, { leads, reservas }, pagamentos, visitas] = await Promise.all([
    listarConversasResumo(), listarOrigens().catch(() => []), listarDados(), listarPagamentos(), listarVisitas(desde).catch(() => []),
  ]);
  const origemDe = new Map(origens.map((o) => [o.conversa_id, o]));
  const pagDe = new Map(pagamentos.map((p) => [p.lead_id, p]));
  const linhas = new Map();
  const linha = (o) => {
    const chave = `${fonte(o)}|${o?.utm_campaign ?? ""}`;
    if (!linhas.has(chave)) linhas.set(chave, { fonte: fonte(o), campanha: o?.utm_campaign ?? null, visitantes: 0, conversas: 0, links: 0, reservas: 0, receita: 0 });
    return linhas.get(chave);
  };
  // Visitantes do site (cada navegador conta uma vez por origem)
  const vistos = new Set();
  for (const v of visitas) {
    const o = v.utm_source || v.referrer ? v : null;
    const chave = `${v.visitante}|${fonte(o)}|${o?.utm_campaign ?? ""}`;
    if (!vistos.has(chave)) { vistos.add(chave); linha(o).visitantes++; }
  }
  for (const c of conversas.filter((c) => (c.atualizado_em ?? "") >= desde)) linha(origemDe.get(c.id)).conversas++;
  const vendas = [];
  for (const l of leads.filter((l) => l.criado_em >= desde)) {
    const o = origemDe.get(l.conversa_id);
    const item = linha(o);
    item.links++;
    const r = reservas.find((x) => x.lead_id === l.id && ["confirmada", "concluida"].includes(x.status));
    if (r) {
      item.reservas++;
      item.receita += Number(r.valor ?? 0);
      vendas.push({ codigo: r.codigo_motor, valor: Number(r.valor ?? 0), quando: pagDe.get(l.id)?.pago_em ?? r.criado_em ?? l.criado_em, fonte: fonte(o), campanha: o?.utm_campaign ?? null, gclid: o?.gclid ?? null });
    }
  }
  return { linhas: [...linhas.values()].sort((a, b) => b.receita - a.receita || b.conversas - a.conversas || b.visitantes - a.visitantes), vendas };
}

admin.get("/campanhas", rota(async (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
  const { linhas, vendas } = await dadosCampanhas(dias);
  const pub = configPublica();
  res.json({
    dias, linhas, vendas: vendas.slice(0, 50),
    conversoes: await listarConversoes(50).catch(() => []),
    config: { meta_capi: Boolean(configMeta()), meta_pixel: Boolean(pub.meta_pixel), meta_whatsapp: Boolean(configMeta()?.waba), google_tag: Boolean(pub.google_ads && pub.google_compra), gtm: Boolean(pub.gtm) },
    link_base: baseUrl(req),
  });
}));

// Conversões offline para importar no Google Ads (reservas pagas que vieram de clique com gclid)
admin.get("/campanhas/google-ads.csv", rota(async (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 90, 1), 90);
  const { vendas } = await dadosCampanhas(dias);
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=conversoes-google-ads.csv" })
    .send(csvGoogleAds(vendas));
}));

// ---- Leads dos formulários da Meta: chamados no WhatsApp pelo assistente ----

// Situação de cada lead até a venda: recebido, chamado, respondeu, recebeu link, pagou
admin.get("/leads-meta", rota(async (_req, res) => {
  const [lista, { leads }, pagamentos] = await Promise.all([listarLeadsMeta().catch(() => []), listarDados(), listarPagamentos()]);
  const pagos = new Set(pagamentos.filter((p) => ["pre_autorizado", "capturado", "pago"].includes(p.status)).map((p) => p.lead_id));
  const linhas = lista.map((l) => {
    const links = l.conversa_id ? leads.filter((x) => x.conversa_id === l.conversa_id) : [];
    const pago = links.find((x) => pagos.has(x.id));
    const etapa = pago ? "pagou" : links.length ? "link" : l.respondeu_em ? "respondeu" : l.status;
    return { ...l, etapa, links: links.length, reserva_lead: pago?.id ?? null };
  });
  const conta = (e) => linhas.filter((l) => l.etapa === e).length;
  res.json({
    leads: linhas, modo: modoLeadsMeta(),
    funil: { recebidos: linhas.length, chamados: linhas.filter((l) => l.contatado_em).length, responderam: linhas.filter((l) => l.respondeu_em).length, links: conta("link") + conta("pagou"), pagos: conta("pagou") },
  });
}));

// Chama de novo no WhatsApp (ex.: modelo aprovado depois, ou falha no envio)
admin.post("/leads-meta/:id/chamar", rota(async (req, res) => {
  const lead = await buscarLeadMeta(req.params.id);
  if (!lead) return res.status(404).json({ erro: "Lead não encontrado" });
  const r = await contatarLead(lead);
  res.status(r.status === "contatado" ? 200 : 409).json(r.status === "contatado" ? { ok: true } : { erro: r.erro || r.status });
}));

// Lead de teste, para ver o fluxo sem anúncio no ar
admin.post("/leads-meta/teste", rota(async (req, res) => {
  const b = req.body ?? {};
  if (!String(b.telefone ?? "").replace(/\D/g, "")) return res.status(400).json({ erro: "Informe o telefone (WhatsApp)." });
  const respostas = String(b.respostas ?? "").split("\n").map((x) => x.split(":")).filter(([p, r]) => p?.trim() && r?.trim())
    .map(([p, ...r]) => ({ pergunta: p.trim(), resposta: r.join(":").trim() }));
  const lead = await receberLead({
    id: `teste-${crypto.randomBytes(4).toString("hex")}`, nome: String(b.nome ?? "").slice(0, 120) || "Teste",
    telefone: b.telefone, email: b.email || null, respostas, campanha: "teste", ad_nome: "teste",
  });
  res.json({ ok: lead.status === "contatado", status: lead.status, erro: lead.erro ?? null, conversa_id: lead.conversa_id ?? null });
}));

// ---- Resultados de marketing: investimento, reservas, ROAS, alertas e importações ----
admin.use("/resultados", resultados);
