// Leitura da zona MRZ (as linhas com "<<<" no passaporte e na Carteira de Identidade Nacional).
// Roda no navegador: a foto não sai do celular do hóspede. Só aceita campos cujos dígitos verificadores conferem.
(function () {
  const PESOS = [7, 3, 1];
  const valor = (c) => (c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
  const digito = (s) => String([...s].reduce((t, c, i) => t + valor(c) * PESOS[i % 3], 0) % 10);
  // Em campos numéricos o OCR confunde letras com números
  const numerico = (s) => s.replace(/O|Q|D/g, "0").replace(/I|L/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/B/g, "8").replace(/G/g, "6");
  const confere = (campo, cd) => digito(campo) === numerico(cd);
  const confereNum = (campo, cd) => digito(numerico(campo)) === numerico(cd);

  const ISO3 = { BRA: "BR", ARG: "AR", URY: "UY", PRY: "PY", CHL: "CL", BOL: "BO", PER: "PE", COL: "CO", VEN: "VE", MEX: "MX", USA: "US", CAN: "CA", PRT: "PT", ESP: "ES", ITA: "IT", FRA: "FR", DEU: "DE", D: "DE", GBR: "GB", JPN: "JP", CHN: "CN", NLD: "NL", CHE: "CH", BEL: "BE", AUT: "AT", IRL: "IE", ISR: "IL", ECU: "EC", AUS: "AU", RUS: "RU", KOR: "KR", IND: "IN", ZAF: "ZA" };

  function data(aammdd, hoje = new Date()) {
    const d = numerico(aammdd);
    if (!/^\d{6}$/.test(d)) return null;
    const aa = Number(d.slice(0, 2)), mm = d.slice(2, 4), dd = d.slice(4, 6);
    const seculo = aa > hoje.getFullYear() % 100 ? 1900 : 2000;
    const iso = `${seculo + aa}-${mm}-${dd}`;
    const t = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
  }

  const titulo = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  function nome(campo) {
    const [sobrenome, nomes = ""] = campo.split("<<");
    const limpa = (x) => x.replace(/<+/g, " ").replace(/[^A-Z ]/g, "").trim();
    return titulo(`${limpa(nomes)} ${limpa(sobrenome)}`.trim());
  }

  // Linhas candidatas: só A-Z, 0-9 e "<", com o tamanho do TD3 (44) ou TD1 (30)
  function linhas(texto) {
    return String(texto).toUpperCase().replace(/«/g, "<<").replace(/[ \t]/g, "").split(/\r?\n/)
      .map((l) => l.replace(/[^A-Z0-9<]/g, ""))
      .filter((l) => l.length >= 28 && (l.includes("<") || /^\d{6}/.test(l)));
  }
  const ajusta = (l, n) => (l.length >= n ? l.slice(0, n) : l + "<".repeat(n - l.length));

  function resultado({ tipo, nomeCampo, doc, cdDoc, nac, nasc, cdNasc, sexo, cpfOpcional }) {
    const r = { formato: tipo };
    if (confereNum(nasc, cdNasc)) r.nascimento = data(nasc);
    if (!r.nascimento) return null; // sem a data conferida, a leitura não é confiável
    const n = nome(nomeCampo);
    if (n.split(" ").length >= 2) r.nome = n;
    const pais = ISO3[nac.replace(/</g, "")];
    if (pais) r.nacionalidade = pais;
    if (sexo === "M") r.genero = "HOMEM";
    if (sexo === "F") r.genero = "MULHER";
    const numero = doc.replace(/</g, "");
    if (tipo === "passaporte" && numero && confere(doc, cdDoc)) { r.documento_tipo = "PASSAPORTE"; r.documento_numero = numero; }
    if (cpfOpcional) { r.documento_tipo = "CPF"; r.documento_numero = cpfOpcional; }
    return r;
  }

  function cpfValido(c) {
    if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
    const dv = (n) => { const s = [...c.slice(0, n)].reduce((t, d, i) => t + Number(d) * (n + 1 - i), 0); return ((s * 10) % 11) % 10; };
    return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
  }

  function lerMRZ(texto) {
    const ls = linhas(texto);
    // TD3 (passaporte): 2 linhas de 44
    for (let i = 0; i + 1 < ls.length; i++) {
      if (!/^P/.test(ls[i]) || ls[i].length < 40 || ls[i + 1].length < 40) continue;
      const a = ajusta(ls[i], 44), b = ajusta(ls[i + 1], 44);
      const r = resultado({ tipo: "passaporte", nomeCampo: a.slice(5), doc: b.slice(0, 9), cdDoc: b[9], nac: b.slice(10, 13), nasc: b.slice(13, 19), cdNasc: b[19], sexo: b[20] });
      if (r) return r;
    }
    // TD1 (Carteira de Identidade Nacional e outras identidades): 3 linhas de 30
    for (let i = 0; i + 2 < ls.length; i++) {
      if (!/^[IAC]/.test(ls[i])) continue;
      const a = ajusta(ls[i], 30), b = ajusta(ls[i + 1], 30), c = ajusta(ls[i + 2], 30);
      // Na CIN o número do documento é o CPF; só usa se for um CPF válido
      const candidatos = [a.slice(5, 14) + a.slice(15, 17), a.slice(15, 30).replace(/</g, "").slice(0, 11), b.slice(18, 29).replace(/</g, "")].map(numerico);
      const cpf = candidatos.find(cpfValido) ?? null;
      const r = resultado({ tipo: "identidade", nomeCampo: c, doc: a.slice(5, 14), cdDoc: a[14], nac: b.slice(15, 18), nasc: b.slice(0, 6), cdNasc: b[6], sexo: b[7], cpfOpcional: cpf });
      if (r) return r;
    }
    return null;
  }

  globalThis.lerMRZ = lerMRZ;
  globalThis.digitoMRZ = digito;
})();
