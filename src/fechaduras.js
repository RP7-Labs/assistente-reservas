// Senhas das fechaduras pela API aberta da TTLock (as mesmas fechaduras que a TAG usa).
// Sem as variáveis TTLOCK_*, as senhas são simuladas: geradas e guardadas aqui, sem falar com a fechadura.
// Para a senha chegar à fechadura pela internet, ela precisa estar ligada a um gateway Wi-Fi da TTLock.
import crypto from "node:crypto";

export function configTTLock(env = process.env) {
  const { TTLOCK_CLIENT_ID: clientId, TTLOCK_CLIENT_SECRET: segredo, TTLOCK_USERNAME: usuario, TTLOCK_PASSWORD: senha } = env;
  if (!clientId || !segredo || !usuario || !senha) return null;
  return { url: (env.TTLOCK_API || "https://euapi.ttlock.com").replace(/\/$/, ""), clientId, segredo, usuario, senha };
}

export const modoFechaduras = () => (configTTLock() ? "ttlock" : "simulado");

// Senha numérica de 6 dígitos, sem sequências óbvias
export function novaSenha() {
  for (;;) {
    const s = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    if (!/^(\d)\1+$/.test(s) && !"0123456789".includes(s) && !"9876543210".includes(s)) return s;
  }
}

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

async function chamar(cfg, caminho, campos, buscarFn) {
  const r = await buscarFn(`${cfg.url}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(campos).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  // A TTLock responde 200 com errcode diferente de 0 quando algo dá errado
  if (!r.ok || (j.errcode != null && j.errcode !== 0)) throw new Error(`TTLock ${j.errcode ?? r.status}: ${j.errmsg ?? j.description ?? "falha"}`);
  return j;
}

// O token vale por dias; numa função serverless o cache dura enquanto a instância estiver viva
let cache = null;
async function token(cfg, buscarFn) {
  if (cache && cache.chave === cfg.usuario && cache.expira > Date.now()) return cache.token;
  const j = await chamar(cfg, "/oauth2/token", {
    clientId: cfg.clientId, clientSecret: cfg.segredo, username: cfg.usuario,
    // A TTLock pede o MD5 da senha, a não ser que a variável já venha com o hash
    password: /^[a-f0-9]{32}$/.test(cfg.senha) ? cfg.senha : md5(cfg.senha),
  }, buscarFn);
  cache = { chave: cfg.usuario, token: j.access_token, expira: Date.now() + Math.max((j.expires_in ?? 3600) - 300, 60) * 1000 };
  return cache.token;
}
export const limparCacheToken = () => { cache = null; };

// Cria a senha na fechadura, válida só entre `inicio` e `fim` (Date)
export async function criarSenhaTTLock({ lockId, senha, nome, inicio, fim }, cfg = configTTLock(), buscarFn = fetch) {
  const accessToken = await token(cfg, buscarFn);
  const j = await chamar(cfg, "/v3/keyboardPwd/add", {
    clientId: cfg.clientId, accessToken, lockId: String(lockId), keyboardPwd: senha, keyboardPwdName: nome.slice(0, 50),
    startDate: String(inicio.getTime()), endDate: String(fim.getTime()),
    addType: "2", // 2 = pelo gateway (pela internet)
    date: String(Date.now()),
  }, buscarFn);
  return { id: String(j.keyboardPwdId) };
}

export async function apagarSenhaTTLock({ lockId, senhaId }, cfg = configTTLock(), buscarFn = fetch) {
  const accessToken = await token(cfg, buscarFn);
  await chamar(cfg, "/v3/keyboardPwd/delete", {
    clientId: cfg.clientId, accessToken, lockId: String(lockId), keyboardPwdId: String(senhaId), deleteType: "2", date: String(Date.now()),
  }, buscarFn);
}
