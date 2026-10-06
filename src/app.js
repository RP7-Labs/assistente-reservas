import express from "express";
import { responder, modoAssistente } from "./assistente.js";
import { carregarHotel, montarLinkMotor } from "./catalogo.js";
import { buscarLead, registrarClique, resumo, verificarBanco } from "./store.js";
import { rotasWhatsapp } from "./whatsapp.js";
import { admin } from "./admin.js";
import { pagamento, rotaLembretes } from "./pagamento.js";
import { modoEmail } from "./email.js";

export const app = express();
app.use(express.json());

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
    modoAssistente() === "regras"
      ? { nome: "ia", estado: "pendente", detalhe: "modo sem IA (regras) ativo; o chat funciona" }
      : config("ia", "ANTHROPIC_API_KEY"),
    config("whatsapp", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"),
    { nome: "pagamento", estado: "pendente", detalhe: "checkout simulado (cartão pré-autorizado e Pix de teste)" },
    modoEmail() === "resend"
      ? { nome: "email", estado: "ok", detalhe: "envio pela Resend" }
      : { nome: "email", estado: "pendente", detalhe: "simulado: e-mails ficam no back-office (falta RESEND_API_KEY, EMAIL_FROM)" },
    config("rastreio", "PUBLIC_URL"),
  ];
  res.status(banco.ok ? 200 : 503).json({ ok: banco.ok, servicos, verificado_em: new Date().toISOString() });
});

app.post("/api/chat", async (req, res) => {
  const { conversaId, texto } = req.body ?? {};
  if (!conversaId || !texto) return res.status(400).json({ erro: "conversaId e texto são obrigatórios" });
  try {
    res.json(await responder({ conversaId, texto, canal: "web" }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Falha ao responder" });
  }
});

// Link rastreável: conta o clique e redireciona para o motor de reservas
app.get("/r/:id", async (req, res) => {
  try {
    const lead = await buscarLead(req.params.id);
    if (!lead) return res.status(404).send("Link não encontrado");
    await registrarClique(lead.id);
    const hotel = carregarHotel();
    // Por padrão vai para o checkout próprio (simulado). CHECKOUT_MODO=motor manda para o motor de reservas.
    if (process.env.CHECKOUT_MODO !== "motor") return res.redirect(302, `/pagamento?lead=${encodeURIComponent(lead.id)}`);
    const quarto = hotel.quartos.find((q) => q.id === lead.quarto_id);
    res.redirect(302, montarLinkMotor(hotel, quarto, lead, lead.id));
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro");
  }
});

app.get("/api/metricas", async (_req, res) => {
  try {
    res.json(await resumo());
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Falha ao calcular métricas" });
  }
});

app.use("/api/admin", admin);
app.use("/api/pagamento", pagamento);
// Lembretes de pagamento por e-mail; chamado a cada minuto pelo agendador (pg_cron do Supabase)
app.all("/api/tarefas/lembretes", rotaLembretes);

rotasWhatsapp(app);
