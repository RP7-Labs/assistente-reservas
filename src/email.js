// Envio de e-mail. Com RESEND_API_KEY e EMAIL_FROM, envia de verdade pela Resend.
// Sem eles, só registra o e-mail (modo simulado), visível no back-office.
import { registrarEmail } from "./store.js";

export const modoEmail = () => (process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? "resend" : "simulado");

export async function enviarEmail({ para, assunto, texto, tipo = null, leadId = null }) {
  const provedor = modoEmail();
  let erro = null;
  if (provedor === "resend") {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [para], subject: assunto, text: texto }),
      });
      if (!r.ok) erro = `Resend ${r.status}: ${(await r.text()).slice(0, 300)}`;
    } catch (err) {
      erro = `Resend: ${err.message}`;
    }
  }
  await registrarEmail({ para, assunto, corpo: texto, tipo, lead_id: leadId, provedor, erro });
  return { ok: !erro, provedor, erro };
}
