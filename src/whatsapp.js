import { responder } from "./assistente.js";
import { origemWhatsapp, registrarOrigem } from "./rastreio.js";
import { marcarRespostaLeadMeta } from "./store.js";

// Webhook da WhatsApp Cloud API (Meta).
export function rotasWhatsapp(app) {
  app.get("/webhook/whatsapp", (req, res) => {
    const ok = req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN;
    return ok ? res.send(req.query["hub.challenge"]) : res.sendStatus(403);
  });

  app.post("/webhook/whatsapp", async (req, res) => {
    // Processa antes de responder: na Vercel a função é congelada depois da resposta
    const msgs = req.body?.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []) ?? [];
    for (const m of msgs) {
      // Texto digitado ou toque em botão/lista (o id do botão é o texto da opção)
      const texto = m.type === "text" ? m.text.body
        : m.type === "interactive" ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id) : null;
      if (!texto) continue;
      try {
        // Conversa aberta por anúncio de clique para o WhatsApp: guarda o anúncio e o ctwa_clid
        const origem = origemWhatsapp(m);
        if (origem) await registrarOrigem(`wa:${m.from}`, "whatsapp", origem).catch((err) => console.error("origem:", err.message));
        // Lead de formulário da Meta que respondeu à primeira mensagem
        await marcarRespostaLeadMeta(`wa:${m.from}`).catch(() => {});
        const { resposta, opcoes } = await responder({ conversaId: `wa:${m.from}`, texto, canal: "whatsapp" });
        await enviar(m.from, montarMensagem(resposta, opcoes));
      } catch (err) {
        console.error("Erro no WhatsApp:", err);
      }
    }
    res.sendStatus(200);
  });
}

const corta = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Até 3 opções viram botões; até 10, uma lista. Seletor de data não existe no WhatsApp: o hóspede digita.
export function montarMensagem(texto, opcoes = []) {
  const ops = opcoes.filter((o) => o.texto && o.tipo !== "data").slice(0, 10);
  if (!ops.length) return { type: "text", text: { body: texto } };
  if (ops.length <= 3) {
    return { type: "interactive", interactive: { type: "button", body: { text: corta(texto, 1024) },
      action: { buttons: ops.map((o) => ({ type: "reply", reply: { id: corta(o.texto, 256), title: corta(o.rotulo, 20) } })) } } };
  }
  return { type: "interactive", interactive: { type: "list", body: { text: corta(texto, 4096) },
    action: { button: "Ver opções", sections: [{ title: "Opções", rows: ops.map((o) => ({ id: corta(o.texto, 200), title: corta(o.rotulo, 24) })) }] } } };
}

export const whatsappConfigurado = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

// Envia uma mensagem pela Cloud API. Devolve { ok, erro? } para quem precisa saber se saiu.
export async function enviar(para, mensagem, buscarFn = fetch) {
  const texto = mensagem.text?.body ?? mensagem.interactive?.body?.text ?? mensagem.template?.name;
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  if (!whatsappConfigurado()) {
    console.warn("WhatsApp não configurado; mensagem:", texto);
    return { ok: false, erro: "WhatsApp não configurado", simulado: true };
  }
  try {
    const r = await buscarFn(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: para, ...mensagem }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: true, waId: j.contacts?.[0]?.wa_id ?? null };
    }
    const erro = (await r.text()).slice(0, 300);
    console.error("Falha ao enviar WhatsApp:", r.status, erro);
    return { ok: false, erro: `${r.status}: ${erro}` };
  } catch (err) {
    console.error("Falha ao enviar WhatsApp:", err.message);
    return { ok: false, erro: err.message };
  }
}
