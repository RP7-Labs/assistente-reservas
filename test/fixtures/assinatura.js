// PNG válido (ruído 40x20) para simular a assinatura desenhada no pré-check-in
import zlib from "node:zlib";
import crypto from "node:crypto";

const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const bloco = (tipo, dados) => {
  const t = Buffer.from(tipo), tam = Buffer.alloc(4), c = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
  return Buffer.concat([tam, t, dados, c]);
};
export function pngAssinatura(l = 40, a = 20) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(a, 4); ihdr[8] = 8; ihdr[9] = 0;
  const linhas = Buffer.concat(Array.from({ length: a }, () => Buffer.concat([Buffer.from([0]), crypto.randomBytes(l)])));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", zlib.deflateSync(linhas)), bloco("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
