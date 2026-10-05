import fs from "node:fs";
// Import estático para o arquivo entrar no pacote da Vercel
import hotelPadrao from "../data/hotel.json" with { type: "json" };

export function carregarHotel(arquivo = process.env.HOTEL_FILE) {
  return arquivo ? JSON.parse(fs.readFileSync(arquivo, "utf8")) : hotelPadrao;
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(s) {
  if (!DATA_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Valida o pedido contra o catálogo. É aqui que garantimos que o hóspede
// recebe o link do quarto que pediu, e não de outro.
export function validarPedido(hotel, { quarto_id, checkin, checkout, adultos, criancas = 0 }, hoje = new Date()) {
  const quarto = hotel.quartos.find((q) => q.id === quarto_id);
  if (!quarto) {
    return { ok: false, erro: `Quarto "${quarto_id}" não existe. Opções: ${hotel.quartos.map((q) => q.id).join(", ")}` };
  }
  if (!dataValida(checkin) || !dataValida(checkout)) {
    return { ok: false, erro: "Datas devem estar no formato AAAA-MM-DD." };
  }
  const hojeStr = hoje.toISOString().slice(0, 10);
  if (checkin < hojeStr) return { ok: false, erro: "O check-in não pode ser no passado." };
  if (checkout <= checkin) return { ok: false, erro: "O check-out precisa ser depois do check-in." };
  if (!Number.isInteger(adultos) || adultos < 1) return { ok: false, erro: "Informe pelo menos 1 adulto." };
  if (!Number.isInteger(criancas) || criancas < 0) return { ok: false, erro: "Número de crianças inválido." };
  if (adultos > quarto.capacidade_adultos || adultos + criancas > quarto.capacidade_total) {
    const cabem = hotel.quartos
      .filter((q) => adultos <= q.capacidade_adultos && adultos + criancas <= q.capacidade_total)
      .map((q) => q.nome);
    return {
      ok: false,
      erro: `${quarto.nome} comporta até ${quarto.capacidade_adultos} adultos e ${quarto.capacidade_total} pessoas no total.` +
        (cabem.length ? ` Opções que comportam o grupo: ${cabem.join(", ")}.` : " Nenhum quarto comporta esse grupo sozinho."),
    };
  }
  const noites = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000);
  return { ok: true, quarto, noites };
}

export function montarLinkMotor(hotel, quarto, { checkin, checkout, adultos, criancas = 0 }, leadId) {
  const base = hotel.motor.link_modelo
    .replace("{codigo_motor}", encodeURIComponent(quarto.codigo_motor))
    .replace("{checkin}", checkin)
    .replace("{checkout}", checkout)
    .replace("{adultos}", String(adultos))
    .replace("{criancas}", String(criancas));
  const url = new URL(base);
  // Atribuição: identifica que a reserva veio do assistente
  url.searchParams.set("utm_source", "assistente");
  url.searchParams.set("utm_medium", "chat");
  url.searchParams.set("utm_campaign", "canal_direto");
  if (leadId) url.searchParams.set("utm_content", leadId);
  return url.toString();
}
