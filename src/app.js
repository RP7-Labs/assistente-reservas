import express from "express";
import { responder, modoAssistente } from "./assistente.js";
import { carregarHotel, montarLinkMotor, noHotel, prepararHotel, hotelDoDominio, hoteisAtivos } from "./catalogo.js";
import { HOTEL_PADRAO, SLUG_RE, simulacaoPermitida } from "./tenant.js";
import { buscarLead, registrarClique, resumo, verificarBanco, localizarHotel, registrarVisita, salvarOrigem } from "./store.js";
import { rotasWhatsapp } from "./whatsapp.js";
import { rotasLeadsMeta, modoLeadsMeta } from "./leadsMeta.js";
import { admin } from "./admin.js";
import { pagamento, rotaLembretes, enviarLembretes } from "./pagamento.js";
import { configGetnet } from "./getnet.js";
import { modoEmail } from "./email.js";
import { calendarioExportado, sincronizarCanais } from "./canais.js";
import { checkin, tarefasSenhas } from "./checkin.js";
import { modoFechaduras } from "./fechaduras.js";
import { modoFNRH, tarefasFNRH } from "./fnrh.js";
import { configPublica, normalizarOrigem, registrarOrigem, codigoWhatsapp, linkWhatsappSite } from "./rastreio.js";
import { dadosSite } from "./site.js";
import { paginaSite } from "./sitePagina.js";
import { legal, textoPrivacidade, textoTermosReserva, versao } from "./legal.js";

export const app = express();
// Guarda o corpo bruto para conferir a assinatura dos webhooks da Meta
app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Hotel do pedido: cabeçalho X-Hotel ou ?hotel=<id>, domínio cadastrado no hotel, ou o hotel padrão.
// Links com id próprio (pagamento, check-in, calendário) acham o hotel pelo id, mais abaixo.
app.use(async (req, res, next) => {
  try {
    const pedido = String(req.get("x-hotel") ?? req.query.hotel ?? "").trim().toLowerCase();
    let id = HOTEL_PADRAO;
    if (pedido) {
      if (!SLUG_RE.test(pedido) || !(await prepararHotel(pedido))) return res.status(404).json({ erro: "Hotel não encontrado" });
      id = pedido;
    } else {
      id = (await hotelDoDominio(req.hostname)) ?? HOTEL_PADRAO;
    }
    await noHotel(id, () => next());
  } catch (err) {
    next(err);
  }
});

// Mostra o que já está configurado, sem expor valores
app.get("/api/status", (_req, res) => {
  const tem = (v) => Boolean(process.env[v]);
  res.json({
    ia: tem("ANTHROPIC_API_KEY"),
    assistente: modoAssistente(),
    banco: tem("SUPABASE_URL") && tem("SUPABASE_SERVICE_ROLE_KEY") ? "supabase" : "arquivo local",
    public_url: process.env.PUBLIC_URL || null,
    whatsapp: tem("WHATSAPP_TOKEN") && tem("WHATSAPP_PHONE_NUMBER_ID"),
  });
});

// Saúde dos serviços, usada pela página /status.
// estado: "ok" | "pendente" (falta configurar) | "erro"
app.get("/api/health", async (_req, res) => {
  const banco = await verificarBanco();
  const config = (nome, ...vars) => {
    const ok = vars.every((v) => process.env[v]);
    return { nome, estado: ok ? "ok" : "pendente", detalhe: ok ? "configurado" : `falta ${vars.filter((v) => !process.env[v]).join(", ")}` };
  };
  const servicos = [
    { nome: "banco", estado: banco.ok ? "ok" : "erro", detalhe: banco.detalhe, ms: banco.ms },
    {
      regras: { nome: "ia", estado: "pendente", detalhe: "modo sem IA (regras) ativo; o chat funciona" },
      gratis: { nome: "ia", estado: "ok", detalhe: `IA gratuita (${process.env.LLM_PROVEDOR || "gemini"}); se falhar, responde por regras` },
      ia: { nome: "ia", estado: "ok", detalhe: "Claude configurado" },
    }[modoAssistente()],
    config("whatsapp", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"),
    (() => {
      const g = configGetnet();
      if (!g) return { nome: "pagamento", estado: "pendente", detalhe: `${simulacaoPermitida() ? "checkout simulado" : "pagamento online desligado"} (falta GETNET_CLIENT_ID, GETNET_CLIENT_SECRET, GETNET_SELLER_ID)` };
      if (!g.notificacao) return { nome: "pagamento", estado: "erro", detalhe: "Getnet sem GETNET_SEGREDO_NOTIFICACAO: os pagamentos não são confirmados" };
      return { nome: "pagamento", estado: "ok", detalhe: `Getnet (${g.ambiente})` };
    })(),
    modoEmail() === "resend"
      ? { nome: "email", estado: "ok", detalhe: "envio pela Resend" }
      : { nome: "email", estado: "pendente", detalhe: "não enviados: e-mails ficam só no back-office (falta RESEND_API_KEY, EMAIL_FROM)" },
    modoFechaduras() === "ttlock"
      ? { nome: "fechaduras", estado: "ok", detalhe: "senhas gravadas nas fechaduras pela TTLock" }
      : { nome: "fechaduras", estado: "pendente", detalhe: `${simulacaoPermitida() ? "senhas simuladas" : "senha entregue pela recepção"} (falta TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD)` },
    modoFNRH() === "simulado"
      ? { nome: "fnrh", estado: "pendente", detalhe: "fichas guardadas aqui, sem envio (falta FNRH_USUARIO, FNRH_SENHA, FNRH_CPF_SOLICITANTE)" }
      : { nome: "fnrh", estado: "ok", detalhe: `envio à FNRH Digital (${modoFNRH()})` },
    config("rastreio", "PUBLIC_URL"),
    { nome: "leads_meta", ...modoLeadsMeta() },
  ];
  res.status(banco.ok ? 200 : 503).json({ ok: banco.ok, servicos, verificado_em: new Date().toISOString() });
});

// IDs públicos do Pixel da Meta e da tag do Google Ads (sem tokens)
app.get("/api/rastreio/config", (_req, res) => res.json(configPublica()));

// Visita a uma página do site: guarda só a origem (sem IP nem dado pessoal), para o funil por origem
const VISITANTE_RE = /^[a-z0-9-]{8,40}$/i;
app.post("/api/rastreio/visita", async (req, res) => {
  const { visitante, pagina, origem } = req.body ?? {};
  if (!VISITANTE_RE.test(String(visitante ?? ""))) return res.status(400).json({ erro: "visitante inválido" });
  const o = normalizarOrigem(origem ?? {});
  await registrarVisita({
    visitante, pagina: String(pagina ?? "").slice(0, 120) || null,
    utm_source: o.utm_source, utm_medium: o.utm_medium, utm_campaign: o.utm_campaign, referrer: o.referrer,
  }).catch((err) => console.error("visita:", err.message));
  res.status(204).end();
});

// Botão de WhatsApp do site: guarda a origem com um código curto que vai no texto da mensagem.
// Quando a pessoa manda a mensagem, o webhook liga o código ao número dela (src/whatsapp.js).
app.post("/api/rastreio/whatsapp", async (req, res) => {
  const codigo = codigoWhatsapp();
  const o = normalizarOrigem(req.body?.origem ?? {}, req);
  await salvarOrigem({ conversa_id: `ref:${codigo}`, canal: "site", ...o }).catch((err) => console.error("origem whatsapp:", err.message));
  res.json({ codigo, link: linkWhatsappSite(carregarHotel(), codigo, req.body?.texto) });
});

// Site do hotel, montado no servidor (bom para o Google e para carregar rápido no celular)
app.get(["/site", "/site/"], (req, res) => {
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  res.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
  res.type("html").send(paginaSite(carregarHotel(), { base }));
});

// Política de privacidade e termos da reserva, montados a partir do cadastro do hotel
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
app.get(["/privacidade", "/termos"], (req, res) => {
  const h = carregarHotel();
  const texto = req.path.startsWith("/privacidade") ? textoPrivacidade(h) : textoTermosReserva(h);
  const [titulo, ...resto] = texto.split("\n");
  res.set("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(titulo)}</title><link rel="stylesheet" href="/estilo.css">
<style>body{background:var(--bg,#fafafa)}main{max-width:760px;margin:0 auto;padding:24px 16px 48px}pre{white-space:pre-wrap;font:15px/1.6 var(--font,system-ui);margin:0}.mut{font-size:12.5px}</style></head>
<body><main><h1>${escHtml(titulo)}</h1><pre>${escHtml(resto.join("\n").trim())}</pre><p class="mut">Versão ${versao(texto)}</p></main></body></html>`);
});
app.use("/api/legal", legal);

// Conteúdo público do site do hotel (/site)
app.get("/api/site", (_req, res) => res.json(dadosSite(carregarHotel())));

// Dados públicos do hotel para o chat (nome no topo)
app.get("/api/hotel", (_req, res) => {
  const h = carregarHotel();
  res.json({ nome: h.nome, cidade: h.cidade });
});

app.post("/api/chat", async (req, res) => {
  const { conversaId, texto, origem } = req.body ?? {};
  if (!conversaId || !texto) return res.status(400).json({ erro: "conversaId e texto são obrigatórios" });
  try {
    // De onde a pessoa veio (campanha, clique do anúncio); o chat manda na primeira mensagem
    if (origem && typeof origem === "object") await registrarOrigem(conversaId, "web", normalizarOrigem(origem, req)).catch((err) => console.error("origem:", err.message));
    res.json(await responder({ conversaId, texto, canal: "web" }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Falha ao responder" });
  }
});

// Link rastreável: conta o clique e redireciona para o motor de reservas
app.get("/r/:id", async (req, res) => {
  try {
    const hotelDoLead = await localizarHotel("leads", "id", req.params.id);
    if (!hotelDoLead) return res.status(404).send("Link não encontrado");
    await noHotel(hotelDoLead, () => redirecionarLead(req, res));
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro");
  }
});

async function redirecionarLead(req, res) {
  try {
    const lead = await buscarLead(req.params.id);
    if (!lead) return res.status(404).send("Link não encontrado");
    await registrarClique(lead.id);
    const hotel = carregarHotel();
    // Por padrão vai para o checkout próprio. CHECKOUT_MODO=motor (com o link do motor cadastrado) manda para o motor de reservas.
    const motor = process.env.CHECKOUT_MODO === "motor" && montarLinkMotor(hotel, hotel.quartos.find((q) => q.id === lead.quarto_id), lead, lead.id);
    res.redirect(302, motor || `/pagamento?lead=${encodeURIComponent(lead.id)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro");
  }
}

app.get("/api/metricas", async (_req, res) => {
  try {
    res.json(await resumo());
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Falha ao calcular métricas" });
  }
});

// Calendário iCal que o Airbnb (ou outro canal) importa. O token no link é o segredo.
app.get("/api/ical/:arquivo", async (req, res) => {
  try {
    const token = req.params.arquivo.replace(/\.ics$/, "");
    const hotel = await localizarHotel("canais", "token_exportar", token);
    const ics = hotel && (await noHotel(hotel, () => calendarioExportado(token)));
    if (!ics) return res.status(404).send("Calendário não encontrado");
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" }).send(ics);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro");
  }
});

app.use("/api/admin", admin);
app.use("/api/pagamento", pagamento);
app.use("/api/checkin", checkin);
// Tarefas do agendador (pg_cron do Supabase, a cada minuto): sincroniza os calendários vencidos
// e manda os lembretes de pagamento por e-mail. A rota de lembretes confere o CRON_SECRET.
app.all("/api/tarefas/lembretes", async (req, res, next) => {
  if (process.env.CRON_SECRET && req.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) {
    return res.json(await tarefasDeTodosOsHoteis(urlBase(req)));
  }
  next();
}, rotaLembretes);

const urlBase = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

// Tarefas agendadas, hotel por hotel: calendários, FNRH e lembretes de pagamento
export async function tarefasDeTodosOsHoteis(base) {
  const resultado = {};
  for (const id of await hoteisAtivos()) {
    resultado[id] = await noHotel(id, async () => {
      await sincronizarCanais().catch((err) => console.error(`iCal (${id}):`, err.message));
      await tarefasFNRH().catch((err) => console.error(`FNRH (${id}):`, err.message));
      await tarefasSenhas().catch((err) => console.error(`senhas (${id}):`, err.message));
      return enviarLembretes(base).catch((err) => ({ erro: err.message }));
    });
  }
  return resultado;
}

rotasWhatsapp(app);
rotasLeadsMeta(app);
