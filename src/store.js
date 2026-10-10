import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { hotelId, HOTEL_PADRAO } from "./tenant.js";

// Com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY definidos, grava no Supabase.
// Sem eles (desenvolvimento local e testes), grava em data/local.json.
const usarSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const sb = usarSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      db: { schema: process.env.SUPABASE_SCHEMA || "reservas" },
    })
  : null;

const aqui = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = process.env.LOCAL_DB_FILE || path.join(aqui, "..", "data", "local.json");
const TABELAS = ["leads", "cliques", "reservas", "admins", "pagamentos", "emails", "canais", "bloqueios", "unidades", "checkins", "origens", "conversoes", "leads_meta"];
const vazio = () => ({ ...Object.fromEntries(TABELAS.map((t) => [t, []])), conversas: {}, atendimentos: {} });

// Sem Supabase, cada hotel tem o próprio arquivo (o hotel padrão usa o arquivo original)
const arquivoDo = (h) => (h === HOTEL_PADRAO ? ARQUIVO : ARQUIVO.replace(/\.json$/, "") + `.${h}.json`);
const ARQUIVO_HOTEIS = ARQUIVO.replace(/\.json$/, "") + ".hoteis.json";

function lerArquivo(h = hotelId()) {
  try {
    return { ...vazio(), ...JSON.parse(fs.readFileSync(arquivoDo(h), "utf8")) };
  } catch {
    return vazio();
  }
}
function gravarArquivo(db, h = hotelId()) {
  fs.writeFileSync(arquivoDo(h), JSON.stringify(db, null, 2));
}

// Tabela do hotel atual: toda leitura filtra por hotel_id e toda gravação leva o hotel_id
const comHotel = (r, h) => (Array.isArray(r) ? r.map((x) => ({ ...x, hotel_id: h })) : { ...r, hotel_id: h });
function tab(nome) {
  const h = hotelId();
  return {
    select: (...a) => sb.from(nome).select(...a).eq("hotel_id", h),
    insert: (r, o) => sb.from(nome).insert(comHotel(r, h), o),
    upsert: (r, o) => sb.from(nome).upsert(comHotel(r, h), o),
    update: (r) => sb.from(nome).update(r).eq("hotel_id", h),
    delete: () => sb.from(nome).delete().eq("hotel_id", h),
  };
}

function verificar({ data, error }) {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

export async function criarLead(dados) {
  const lead = { id: crypto.randomBytes(5).toString("hex"), criado_em: new Date().toISOString(), ...dados };
  if (sb) {
    verificar(await tab("leads").insert(lead));
  } else {
    const db = lerArquivo();
    db.leads.push(lead);
    gravarArquivo(db);
  }
  return lead;
}

export async function buscarLead(id) {
  if (sb) return verificar(await tab("leads").select("*").eq("id", id).maybeSingle());
  return lerArquivo().leads.find((l) => l.id === id);
}

export async function registrarClique(leadId) {
  if (sb) {
    verificar(await tab("cliques").insert({ lead_id: leadId }));
    return;
  }
  const db = lerArquivo();
  db.cliques.push({ lead_id: leadId, em: new Date().toISOString() });
  gravarArquivo(db);
}

// Histórico da conversa no formato de mensagens da API do Claude
export async function carregarConversa(id) {
  if (sb) {
    const linha = verificar(await tab("conversas").select("mensagens").eq("id", id).maybeSingle());
    return linha?.mensagens ?? [];
  }
  return lerArquivo().conversas[id] ?? [];
}

export async function salvarConversa(id, canal, mensagens) {
  if (sb) {
    verificar(await tab("conversas").upsert({ id, canal, mensagens, atualizado_em: new Date().toISOString() }));
    return;
  }
  const db = lerArquivo();
  db.conversas[id] = mensagens;
  db.atendimentos[id] = { ...db.atendimentos[id], canal, atualizado_em: new Date().toISOString() };
  gravarArquivo(db);
}

export async function resumo() {
  let leads, cliques;
  if (sb) {
    leads = verificar(await tab("leads").select("id, quarto_id, canal"));
    cliques = verificar(await tab("cliques").select("lead_id"));
  } else {
    ({ leads, cliques } = lerArquivo());
  }
  const clicados = new Set(cliques.map((c) => c.lead_id));
  const contar = (campo) => leads.reduce((acc, l) => ((acc[l[campo]] = (acc[l[campo]] || 0) + 1), acc), {});
  return {
    links_gerados: leads.length,
    links_clicados: clicados.size,
    taxa_clique: leads.length ? +(clicados.size / leads.length).toFixed(3) : 0,
    por_quarto: contar("quarto_id"),
    por_canal: contar("canal"),
  };
}

// Consulta leve para a página de status
export async function verificarBanco() {
  const inicio = Date.now();
  try {
    if (sb) {
      verificar(await tab("leads").select("id").limit(1));
    } else {
      lerArquivo();
    }
    return { ok: true, detalhe: sb ? "Supabase" : "arquivo local", ms: Date.now() - inicio };
  } catch (err) {
    return { ok: false, detalhe: err.message, ms: Date.now() - inicio };
  }
}

// ---- Back-office ----

export async function marcarAtendente(id, precisa, motivo = null) {
  if (sb) {
    verificar(await tab("conversas").update({ precisa_atendente: precisa, motivo_atendente: motivo }).eq("id", id));
    return;
  }
  const db = lerArquivo();
  db.atendimentos[id] = { ...db.atendimentos[id], precisa_atendente: precisa, motivo_atendente: motivo };
  gravarArquivo(db);
}

export async function listarConversas(limite = 200) {
  if (sb) {
    return verificar(
      await tab("conversas")
        .select("id, canal, mensagens, atualizado_em, precisa_atendente, motivo_atendente")
        .order("atualizado_em", { ascending: false })
        .limit(limite),
    );
  }
  const db = lerArquivo();
  return Object.entries(db.conversas)
    .map(([id, mensagens]) => ({ id, mensagens, canal: "web", precisa_atendente: false, motivo_atendente: null, ...db.atendimentos[id] }))
    .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))
    .slice(0, limite);
}

// Só id, canal e data das conversas (sem as mensagens), para relatórios
export async function listarConversasResumo(limite = 2000) {
  if (sb) return verificar(await tab("conversas").select("id, canal, atualizado_em").order("atualizado_em", { ascending: false }).limit(limite));
  const db = lerArquivo();
  return Object.keys(db.conversas).map((id) => ({ id, canal: db.atendimentos[id]?.canal ?? "web", atualizado_em: db.atendimentos[id]?.atualizado_em ?? null }));
}

export async function listarDados() {
  if (sb) {
    const [leads, cliques, reservas] = await Promise.all([
      tab("leads").select("*").order("criado_em", { ascending: false }).limit(1000),
      tab("cliques").select("lead_id, em"),
      tab("reservas").select("*").order("checkin", { ascending: true }),
    ]);
    return { leads: verificar(leads), cliques: verificar(cliques), reservas: verificar(reservas) };
  }
  const { leads, cliques, reservas } = lerArquivo();
  return { leads: [...leads].reverse(), cliques, reservas };
}

export async function salvarReserva(reserva) {
  const linha = { ...reserva, atualizado_em: new Date().toISOString() };
  if (sb) {
    verificar(await tab("reservas").upsert(linha));
    return linha;
  }
  const db = lerArquivo();
  const i = db.reservas.findIndex((r) => r.codigo_motor === linha.codigo_motor);
  if (i >= 0) db.reservas[i] = { ...db.reservas[i], ...linha };
  else db.reservas.push({ criado_em: linha.atualizado_em, ...linha });
  gravarArquivo(db);
  return linha;
}

export async function atualizarStatusReserva(codigo, status) {
  if (sb) {
    const r = verificar(await tab("reservas").update({ status, atualizado_em: new Date().toISOString() }).eq("codigo_motor", codigo).select());
    return r.length > 0;
  }
  const db = lerArquivo();
  const r = db.reservas.find((x) => x.codigo_motor === codigo);
  if (!r) return false;
  r.status = status;
  r.atualizado_em = new Date().toISOString();
  gravarArquivo(db);
  return true;
}

// ---- Usuários do back-office ----

export async function buscarAdminPorEmail(email) {
  if (sb) return verificar(await tab("admins").select("*").eq("email", email).maybeSingle());
  return lerArquivo().admins.find((a) => a.email === email) ?? null;
}

export async function buscarAdmin(id) {
  if (sb) return verificar(await tab("admins").select("*").eq("id", id).maybeSingle());
  return lerArquivo().admins.find((a) => a.id === id) ?? null;
}

export async function listarAdmins() {
  const campos = "id, nome, email, status, aprovado_por, aprovado_em, criado_em";
  if (sb) return verificar(await tab("admins").select(campos).order("criado_em", { ascending: true }));
  return lerArquivo().admins.map(({ senha_hash, ...a }) => a);
}

export async function criarAdmin(dados) {
  const admin = { id: crypto.randomUUID(), criado_em: new Date().toISOString(), aprovado_por: null, aprovado_em: null, ...dados };
  if (sb) {
    verificar(await tab("admins").insert(admin));
    return admin;
  }
  const db = lerArquivo();
  db.admins.push(admin);
  gravarArquivo(db);
  return admin;
}

export async function atualizarAdmin(id, campos) {
  if (sb) {
    verificar(await tab("admins").update(campos).eq("id", id));
    return;
  }
  const db = lerArquivo();
  const a = db.admins.find((x) => x.id === id);
  if (a) Object.assign(a, campos);
  gravarArquivo(db);
}

// ---- Pagamentos (checkout simulado) e e-mails enviados ----

export async function buscarPagamento(leadId) {
  if (sb) return verificar(await tab("pagamentos").select("*").eq("lead_id", leadId).maybeSingle());
  return lerArquivo().pagamentos.find((p) => p.lead_id === leadId) ?? null;
}

// Grava ou atualiza o pagamento do lead (um por link de reserva)
export async function salvarPagamento(dados) {
  const linha = { ...dados, atualizado_em: new Date().toISOString() };
  if (sb) return verificar(await tab("pagamentos").upsert(linha).select().single());
  const db = lerArquivo();
  const i = db.pagamentos.findIndex((p) => p.lead_id === linha.lead_id);
  if (i >= 0) db.pagamentos[i] = { ...db.pagamentos[i], ...linha };
  else db.pagamentos.push(linha);
  gravarArquivo(db);
  return db.pagamentos[i >= 0 ? i : db.pagamentos.length - 1];
}

export async function listarPagamentos() {
  if (sb) return verificar(await tab("pagamentos").select("*").order("iniciado_em", { ascending: false }).limit(500));
  return [...lerArquivo().pagamentos].sort((a, b) => String(b.iniciado_em).localeCompare(String(a.iniciado_em)));
}

// Pagamentos pendentes há mais de `minutos` que ainda não receberam lembrete
export async function pagamentosSemLembrete(minutos, agora = new Date()) {
  const limite = new Date(agora.getTime() - minutos * 60_000).toISOString();
  if (sb) {
    return verificar(await tab("pagamentos").select("*").eq("status", "pendente").is("lembrete_em", null).not("email", "is", null).lte("iniciado_em", limite).limit(50));
  }
  return lerArquivo().pagamentos.filter((p) => p.status === "pendente" && !p.lembrete_em && p.email && p.iniciado_em <= limite);
}

export async function registrarEmail(email) {
  const linha = { criado_em: new Date().toISOString(), ...email };
  if (sb) {
    verificar(await tab("emails").insert(linha));
    return linha;
  }
  const db = lerArquivo();
  db.emails.push({ id: db.emails.length + 1, ...linha });
  gravarArquivo(db);
  return linha;
}

export async function listarEmails(limite = 100) {
  if (sb) return verificar(await tab("emails").select("*").order("criado_em", { ascending: false }).limit(limite));
  return [...lerArquivo().emails].reverse().slice(0, limite);
}

// ---- Canais por iCal (Airbnb, Booking.com) e bloqueios importados ----

export async function listarCanais() {
  if (sb) return verificar(await tab("canais").select("*").order("criado_em"));
  return lerArquivo().canais;
}

export async function buscarCanalPorToken(token) {
  if (sb) return verificar(await tab("canais").select("*").eq("token_exportar", token).maybeSingle());
  return lerArquivo().canais.find((c) => c.token_exportar === token) ?? null;
}

export async function salvarCanal(canal) {
  if (sb) return verificar(await tab("canais").upsert(canal).select().single());
  const db = lerArquivo();
  const i = db.canais.findIndex((c) => c.id === canal.id);
  if (i >= 0) db.canais[i] = { ...db.canais[i], ...canal };
  else db.canais.push({ criado_em: new Date().toISOString(), ...canal });
  gravarArquivo(db);
  return db.canais[i >= 0 ? i : db.canais.length - 1];
}

export async function removerCanal(id) {
  if (sb) {
    verificar(await tab("canais").delete().eq("id", id));
    return;
  }
  const db = lerArquivo();
  db.canais = db.canais.filter((c) => c.id !== id);
  db.bloqueios = db.bloqueios.filter((b) => b.canal_id !== id);
  gravarArquivo(db);
}

// Troca todos os bloqueios do canal pelos que vieram na última leitura do calendário
export async function trocarBloqueios(canalId, bloqueios) {
  if (sb) {
    verificar(await tab("bloqueios").delete().eq("canal_id", canalId));
    if (bloqueios.length) verificar(await tab("bloqueios").insert(bloqueios));
    return;
  }
  const db = lerArquivo();
  db.bloqueios = [...db.bloqueios.filter((b) => b.canal_id !== canalId), ...bloqueios];
  gravarArquivo(db);
}

export async function listarBloqueios() {
  if (sb) return verificar(await tab("bloqueios").select("*").order("checkin"));
  return [...lerArquivo().bloqueios].sort((a, b) => a.checkin.localeCompare(b.checkin));
}

// ---- Check-in digital: unidades com fechadura e fichas ----

export async function listarUnidades() {
  if (sb) return verificar(await tab("unidades").select("*").order("numero"));
  return [...lerArquivo().unidades].sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
}

export async function salvarUnidade(u) {
  if (sb) return verificar(await tab("unidades").upsert(u).select().single());
  const db = lerArquivo();
  const i = db.unidades.findIndex((x) => x.numero === u.numero);
  if (i >= 0) db.unidades[i] = { ...db.unidades[i], ...u };
  else db.unidades.push({ ativa: true, criado_em: new Date().toISOString(), ...u });
  gravarArquivo(db);
  return db.unidades[i >= 0 ? i : db.unidades.length - 1];
}

export async function removerUnidade(numero) {
  if (sb) {
    verificar(await tab("unidades").delete().eq("numero", numero));
    return;
  }
  const db = lerArquivo();
  db.unidades = db.unidades.filter((u) => u.numero !== numero);
  gravarArquivo(db);
}

export async function buscarCheckin({ codigo, token }) {
  if (sb) {
    const q = tab("checkins").select("*");
    return verificar(await (codigo ? q.eq("codigo_reserva", codigo) : q.eq("token", token)).maybeSingle());
  }
  return lerArquivo().checkins.find((c) => (codigo ? c.codigo_reserva === codigo : c.token === token)) ?? null;
}

export async function salvarCheckin(c) {
  const linha = { ...c, atualizado_em: new Date().toISOString() };
  if (sb) return verificar(await tab("checkins").upsert(linha).select().single());
  const db = lerArquivo();
  const i = db.checkins.findIndex((x) => x.codigo_reserva === linha.codigo_reserva);
  if (i >= 0) db.checkins[i] = { ...db.checkins[i], ...linha };
  else db.checkins.push(linha);
  gravarArquivo(db);
  return db.checkins[i >= 0 ? i : db.checkins.length - 1];
}

export async function listarCheckins() {
  if (sb) return verificar(await tab("checkins").select("*"));
  return lerArquivo().checkins;
}

export async function buscarReserva(codigo) {
  if (sb) return verificar(await tab("reservas").select("*").eq("codigo_motor", codigo).maybeSingle());
  return lerArquivo().reservas.find((r) => r.codigo_motor === codigo) ?? null;
}

// ---- Origem das conversas (tráfego pago) e conversões enviadas às plataformas ----

export async function buscarOrigem(conversaId) {
  if (sb) return verificar(await tab("origens").select("*").eq("conversa_id", conversaId).maybeSingle());
  return lerArquivo().origens.find((o) => o.conversa_id === conversaId) ?? null;
}

export async function salvarOrigem(origem) {
  const linha = { ...origem, atualizado_em: new Date().toISOString() };
  if (sb) {
    verificar(await tab("origens").upsert(linha));
    return linha;
  }
  const db = lerArquivo();
  const i = db.origens.findIndex((o) => o.conversa_id === linha.conversa_id);
  if (i >= 0) db.origens[i] = { ...db.origens[i], ...linha };
  else db.origens.push({ criado_em: linha.atualizado_em, ...linha });
  gravarArquivo(db);
  return linha;
}

export async function listarOrigens() {
  if (sb) return verificar(await tab("origens").select("*").order("criado_em", { ascending: false }).limit(5000));
  return lerArquivo().origens;
}

// Grava a tentativa de envio; devolve false se o mesmo evento já tinha sido enviado com sucesso
export async function registrarConversao(c) {
  const linha = { criado_em: new Date().toISOString(), ...c };
  if (sb) {
    const { error } = await tab("conversoes").upsert(linha, { onConflict: "hotel_id,plataforma,evento,event_id" });
    if (error) throw new Error(`Supabase: ${error.message}`);
    return linha;
  }
  const db = lerArquivo();
  const i = db.conversoes.findIndex((x) => x.plataforma === c.plataforma && x.evento === c.evento && x.event_id === c.event_id);
  if (i >= 0) db.conversoes[i] = linha; else db.conversoes.push(linha);
  gravarArquivo(db);
  return linha;
}

export async function buscarConversao(plataforma, evento, eventId) {
  if (sb) return verificar(await tab("conversoes").select("*").eq("plataforma", plataforma).eq("evento", evento).eq("event_id", eventId).maybeSingle());
  return lerArquivo().conversoes.find((x) => x.plataforma === plataforma && x.evento === evento && x.event_id === eventId) ?? null;
}

export async function listarConversoes(limite = 200) {
  if (sb) return verificar(await tab("conversoes").select("*").order("criado_em", { ascending: false }).limit(limite));
  return [...lerArquivo().conversoes].reverse().slice(0, limite);
}

// ---- Leads dos formulários de anúncio da Meta ----

export async function buscarLeadMeta(id) {
  if (sb) return verificar(await tab("leads_meta").select("*").eq("id", id).maybeSingle());
  return lerArquivo().leads_meta.find((l) => l.id === id) ?? null;
}

export async function salvarLeadMeta(lead) {
  const linha = { ...lead, atualizado_em: new Date().toISOString() };
  if (sb) return verificar(await tab("leads_meta").upsert(linha).select().single());
  const db = lerArquivo();
  const i = db.leads_meta.findIndex((l) => l.id === linha.id);
  if (i >= 0) db.leads_meta[i] = { ...db.leads_meta[i], ...linha };
  else db.leads_meta.push({ recebido_em: linha.atualizado_em, status: "novo", tentativas: 0, ...linha });
  gravarArquivo(db);
  return db.leads_meta[i >= 0 ? i : db.leads_meta.length - 1];
}

export async function listarLeadsMeta(limite = 300) {
  if (sb) return verificar(await tab("leads_meta").select("*").order("recebido_em", { ascending: false }).limit(limite));
  return [...lerArquivo().leads_meta].sort((a, b) => String(b.recebido_em).localeCompare(String(a.recebido_em))).slice(0, limite);
}

// Marca a primeira resposta do lead no WhatsApp
export async function marcarRespostaLeadMeta(conversaId, quando = new Date().toISOString()) {
  if (sb) {
    verificar(await tab("leads_meta").update({ respondeu_em: quando, atualizado_em: quando }).eq("conversa_id", conversaId).is("respondeu_em", null));
    return;
  }
  const db = lerArquivo();
  let mudou = false;
  for (const l of db.leads_meta) if (l.conversa_id === conversaId && !l.respondeu_em) { l.respondeu_em = quando; mudou = true; }
  if (mudou) gravarArquivo(db);
}

// ---- Hotéis (cadastro global, fora do filtro por hotel) ----

const lerHoteisArquivo = () => { try { return JSON.parse(fs.readFileSync(ARQUIVO_HOTEIS, "utf8")); } catch { return []; } };

export async function listarHoteis() {
  if (sb) return verificar(await sb.from("hoteis").select("*").order("criado_em", { ascending: true }));
  return lerHoteisArquivo();
}

export async function buscarHotelRegistro(id) {
  if (sb) return verificar(await sb.from("hoteis").select("*").eq("id", id).maybeSingle());
  return lerHoteisArquivo().find((h) => h.id === id) ?? null;
}

export async function salvarHotelRegistro(hotel) {
  const linha = { ...hotel, atualizado_em: new Date().toISOString() };
  if (sb) return verificar(await sb.from("hoteis").upsert(linha).select().single());
  const lista = lerHoteisArquivo();
  const i = lista.findIndex((h) => h.id === linha.id);
  if (i >= 0) lista[i] = { ...lista[i], ...linha };
  else lista.push({ criado_em: linha.atualizado_em, ativo: true, dominios: [], config: {}, ...linha });
  fs.writeFileSync(ARQUIVO_HOTEIS, JSON.stringify(lista, null, 2));
  return lista[i >= 0 ? i : lista.length - 1];
}

// Descobre de qual hotel é um registro a partir de um id global (lead, token de check-in, token do iCal, admin).
// Usado antes de saber o hotel: links de pagamento, check-in, calendários, login.
export async function localizarHotel(tabela, campo, valor) {
  if (valor == null || valor === "") return null;
  if (sb) {
    const r = verificar(await sb.from(tabela).select("hotel_id").eq(campo, valor).limit(1));
    return r[0]?.hotel_id ?? null;
  }
  const ids = [HOTEL_PADRAO, ...lerHoteisArquivo().map((h) => h.id).filter((id) => id !== HOTEL_PADRAO)];
  return ids.find((h) => (lerArquivo(h)[tabela] ?? []).some((x) => String(x[campo]) === String(valor))) ?? null;
}
