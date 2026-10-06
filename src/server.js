// Servidor local. Na Vercel, quem atende é api/index.js.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "./app.js";
import { enviarLembretes } from "./pagamento.js";
import { sincronizarCanais } from "./canais.js";
import { tarefasFNRH } from "./fnrh.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(aqui, "..", "public"), { extensions: ["html"] }));

const porta = process.env.PORT || 3000;
// Localmente, lembretes e calendários rodam aqui a cada minuto (na Vercel, quem chama é o pg_cron)
setInterval(() => {
  enviarLembretes(process.env.PUBLIC_URL || `http://localhost:${porta}`).catch((e) => console.error(e));
  sincronizarCanais().catch((e) => console.error(e));
  tarefasFNRH().catch((e) => console.error(e));
}, 60_000).unref();
app.listen(porta, () => console.log(`Assistente rodando em http://localhost:${porta}`));
