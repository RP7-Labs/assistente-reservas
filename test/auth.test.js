import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "segredo-de-teste-123456";
const { gerarHash, conferirSenha, criarToken, lerToken } = await import("../src/auth.js");

test("hash de senha confere só com a senha certa", async () => {
  const h = await gerarHash("minhasenha");
  assert.match(h, /^scrypt\$/);
  assert.equal(await conferirSenha("minhasenha", h), true);
  assert.equal(await conferirSenha("outra", h), false);
  assert.equal(await conferirSenha("x", "lixo"), false);
});

test("token assinado expira e não aceita adulteração", () => {
  const t = criarToken("abc", 1000);
  assert.equal(lerToken(t, 2000).id, "abc");
  assert.equal(lerToken(t, 1000 + 8 * 24 * 3600 * 1000), null);
  const [p, s] = t.split(".");
  const falso = Buffer.from(JSON.stringify({ id: "outro", exp: 9e15 })).toString("base64url");
  assert.equal(lerToken(`${falso}.${s}`, 2000), null);
  assert.equal(lerToken(`${p}.x`, 2000), null);
  assert.equal(lerToken("", 2000), null);
});
