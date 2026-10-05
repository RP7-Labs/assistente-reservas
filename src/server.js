import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { responder } from "./assistente.js";
import { carregarHotel, montarLinkMotor } from "./catalogo.js";
import { buscarLead, registrarClique, resumo } from "./store.js";
import { rotasWhatsapp } from "./whatsapp.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(aqui, "..", "public")));

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
app.get("/r/:id", (req, res) => {
  const lead = buscarLead(req.params.id);
  if (!lead) return res.status(404).send("Link não encontrado");
  registrarClique(lead.id);
  const hotel = carregarHotel();
  const quarto = hotel.quartos.find((q) => q.id === lead.quarto_id);
  res.redirect(302, montarLinkMotor(hotel, quarto, lead, lead.id));
});

app.get("/api/metricas", (_req, res) => res.json(resumo()));

rotasWhatsapp(app);

const porta = process.env.PORT || 3000;
app.listen(porta, () => console.log(`Assistente rodando em http://localhost:${porta}`));
