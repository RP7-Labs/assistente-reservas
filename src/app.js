import express from "express";
import { responder } from "./assistente.js";
import { carregarHotel, montarLinkMotor } from "./catalogo.js";
import { buscarLead, registrarClique, resumo } from "./store.js";
import { rotasWhatsapp } from "./whatsapp.js";

export const app = express();
app.use(express.json());

// Mostra o que já está configurado, sem expor valores
app.get("/api/status", (_req, res) => {
  const tem = (v) => Boolean(process.env[v]);
  res.json({
    ia: tem("ANTHROPIC_API_KEY"),
    banco: tem("SUPABASE_URL") && tem("SUPABASE_SERVICE_ROLE_KEY") ? "supabase" : "arquivo local",
    public_url: process.env.PUBLIC_URL || null,
    whatsapp: tem("WHATSAPP_TOKEN") && tem("WHATSAPP_PHONE_NUMBER_ID"),
  });
});

app.post("/api/chat", async (req, res) => {
  const { conversaId, texto } = req.body ?? {};
  if (!conversaId || !texto) return res.status(400).json({ erro: "conversaId e texto são obrigatórios" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ erro: "O assistente ainda não está ativo: falta configurar a chave da IA (ANTHROPIC_API_KEY)." });
  }
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

rotasWhatsapp(app);
