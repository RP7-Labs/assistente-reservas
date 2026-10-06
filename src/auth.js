import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const VALIDADE_MS = 7 * 24 * 3600 * 1000;

export async function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const chave = await scrypt(senha, sal, 64);
  return `scrypt$${sal.toString("hex")}$${chave.toString("hex")}`;
}

export async function conferirSenha(senha, hash) {
  const [alg, salHex, chaveHex] = String(hash).split("$");
  if (alg !== "scrypt" || !salHex || !chaveHex) return false;
  const esperada = Buffer.from(chaveHex, "hex");
  const chave = await scrypt(senha, Buffer.from(salHex, "hex"), esperada.length);
  return crypto.timingSafeEqual(chave, esperada);
}

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET não definido (mínimo 16 caracteres)");
  return s;
}

const assinar = (dados) => crypto.createHmac("sha256", segredo()).update(dados).digest("base64url");

// Token de sessão: <payload base64url>.<assinatura HMAC>
export function criarToken(adminId, agora = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ id: adminId, exp: agora + VALIDADE_MS })).toString("base64url");
  return `${payload}.${assinar(payload)}`;
}

export function lerToken(token, agora = Date.now()) {
  const [payload, assinatura] = String(token ?? "").split(".");
  if (!payload || !assinatura) return null;
  const esperada = Buffer.from(assinar(payload));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, "base64url").toString());
    return dados.exp > agora ? dados : null;
  } catch {
    return null;
  }
}

export const normalizarEmail = (e) => String(e ?? "").trim().toLowerCase();
export const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
