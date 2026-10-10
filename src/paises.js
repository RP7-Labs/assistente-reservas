// O que muda de um país para outro: idioma, moeda, fuso, documento do hóspede,
// registro oficial de hóspedes e meio de pagamento padrão.
export const PAISES = {
  BR: { nome: "Brasil", idioma: "pt-BR", moeda: "BRL", fuso: "America/Sao_Paulo", ddi: "55", documentos: ["CPF", "PASSAPORTE"], registro: "fnrh", pagamento: "getnet" },
  AR: { nome: "Argentina", idioma: "es-AR", moeda: "ARS", fuso: "America/Argentina/Buenos_Aires", ddi: "54", documentos: ["DNI", "PASAPORTE"], registro: null, pagamento: "mercadopago" },
  PY: { nome: "Paraguai", idioma: "es-PY", moeda: "PYG", fuso: "America/Asuncion", ddi: "595", documentos: ["CI", "PASAPORTE"], registro: null, pagamento: "bancard" },
  US: { nome: "Estados Unidos", idioma: "en-US", moeda: "USD", fuso: "America/New_York", ddi: "1", documentos: ["PASSPORT", "DRIVER_LICENSE"], registro: null, pagamento: "stripe" },
};

// Completa a configuração do hotel com o padrão do país (o hotel pode sobrescrever idioma, moeda e fuso)
export function comPadroesDoPais(hotel) {
  const pais = PAISES[hotel.pais] ? hotel.pais : "BR";
  const p = PAISES[pais];
  return { ...hotel, pais, idioma: hotel.idioma || p.idioma, moeda: hotel.moeda || p.moeda, fuso: hotel.fuso || p.fuso };
}

export const dadosDoPais = (hotel) => PAISES[hotel?.pais] ?? PAISES.BR;

// Valor na moeda do hotel: R$ 1.234,00 · $ 1.234,00 (ARS) · ₲ 1.234 · $1,234.00
export function dinheiro(valor, hotel = {}) {
  const { idioma = "pt-BR", moeda = "BRL" } = hotel;
  return new Intl.NumberFormat(idioma, { style: "currency", currency: moeda }).format(Number(valor) || 0);
}

// Data de hoje (AAAA-MM-DD) no fuso do hotel
export function hojeNoFuso(fuso = "America/Sao_Paulo", agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(agora);
}
