import { responder } from "./assistente.js";

// Webhook da WhatsApp Cloud API (Meta).
export function rotasWhatsapp(app) {
  app.get("/webhook/whatsapp", (req, res) => {
    const ok = req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN;
    return ok ? res.send(req.query["hub.challenge"]) : res.sendStatus(403);
  });

  app.post("/webhook/whatsapp", async (req, res) => {
    res.sendStatus(200); // responde rápido; a Meta reenvia se demorar
    const msgs = req.body?.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []) ?? [];
    for (const m of msgs) {
      if (m.type !== "text") continue;
      try {
        const { resposta } = await responder({ conversaId: `wa:${m.from}`, texto: m.text.body, canal: "whatsapp" });
        await enviar(m.from, resposta);
      } catch (err) {
        console.error("Erro no WhatsApp:", err);
      }
    }
  });
}

async function enviar(para, texto) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return console.warn("WhatsApp não configurado; resposta:", texto);
  const r = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
  });
  if (!r.ok) console.error("Falha ao enviar WhatsApp:", r.status, await r.text());
}
