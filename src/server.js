// Servidor local. Na Vercel, quem atende é api/index.js.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "./app.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(aqui, "..", "public"), { extensions: ["html"] }));

const porta = process.env.PORT || 3000;
app.listen(porta, () => console.log(`Assistente rodando em http://localhost:${porta}`));
