// Guia da estadia: página pessoal do hóspede (/estadia?c=<token>), aberta pelo mesmo token do pré-check-in.
// Junta os dados da reserva (datas, quarto, senha da porta depois do pré-check-in) com o guia do hotel
// (config "guia": Wi-Fi, regras, estrutura, passeios, restaurantes, contato).
import { envDoHotel } from "./tenant.js";
import { hojeNoFuso } from "./paises.js";

export const linkGuia = (base, token) => `${String(base).replace(/\/$/, "")}/estadia?c=${encodeURIComponent(token)}`;

const DIA_MS = 86_400_000;
const dias = (de, ate) => Math.round((Date.parse(ate) - Date.parse(de)) / DIA_MS);
const mapa = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

// Alta temporada em Balneário Camboriú: dezembro a março (o hotel pode trocar em guia.meses_alta)
export function temporada(data, meses = [12, 1, 2, 3]) {
  return meses.includes(Number(String(data).slice(5, 7))) ? "alta" : "baixa";
}

// Em que momento da estadia o hóspede está, para o topo da página
export function momento(reserva, hoje) {
  const noites = dias(reserva.checkin, reserva.checkout);
  if (hoje < reserva.checkin) return { fase: "antes", faltam: dias(hoje, reserva.checkin), noites };
  if (hoje === reserva.checkin) return { fase: "chegada", noites };
  if (hoje < reserva.checkout) return { fase: "durante", noite: dias(reserva.checkin, hoje) + 1, noites };
  if (hoje === reserva.checkout) return { fase: "saida", noites };
  return { fase: "depois", noites };
}

// Monta o que a página mostra. Senha e quarto só aparecem com o pré-check-in feito e a reserva ativa.
export function montarGuia({ hotel, reserva, ck, quarto, hoje = hojeNoFuso(hotel.fuso) }) {
  const g = hotel.guia ?? {};
  const ativa = ["confirmada", "concluida"].includes(reserva.status);
  const concluido = ck.status === "concluido";
  const senha = ativa && concluido && ["ativa", "simulada"].includes(ck.senha_status) ? ck.senha : null;
  const est = g.estacionamento;
  const alta = temporada(reserva.checkin, g.meses_alta) === "alta";
  const nome = String(ck.hospedes?.[0]?.nome ?? reserva.hospede ?? "").trim();
  return {
    hotel: { nome: g.marca ?? hotel.nome, checkin: hotel.checkin, checkout: hotel.checkout, endereco: g.endereco ?? null, mapa: g.mapa ?? (g.endereco ? mapa(g.endereco) : null), fotos: g.fotos ?? {} },
    hospede: { nome, primeiro_nome: nome.split(/\s+/)[0] || null },
    reserva: {
      codigo: reserva.codigo_motor, quarto: quarto?.nome ?? reserva.quarto_id, checkin: reserva.checkin, checkout: reserva.checkout,
      adultos: reserva.adultos, criancas: reserva.criancas, ativa, ...momento(reserva, hoje),
    },
    acesso: { concluido, unidade: concluido ? ck.unidade ?? null : null, senha, inicio: senha ? ck.senha_inicio : null, fim: senha ? ck.senha_fim : null, simulada: ck.senha_status === "simulada", texto: g.acesso ?? null },
    checkin: { obs: g.checkin_obs ?? null },
    checkout: { obs: g.checkout_obs ?? null, lista: (g.checkout_lista ?? []).map(([titulo, texto]) => ({ titulo, texto })) },
    estacionamento: est ? { valor: alta ? est.alta : est.baixa, alta, baixa_valor: est.baixa, alta_valor: est.alta, texto: est.texto } : null,
    // A senha do Wi-Fi pode ficar fora do repositório (variável WIFI_SENHA do hotel)
    wifi: g.wifi ? { rede: g.wifi.rede, senha: g.wifi.senha ?? envDoHotel().WIFI_SENHA ?? null, dicas: g.wifi.dicas ?? [] } : null,
    estrutura: (g.estrutura ?? []).map(([foto, titulo, texto]) => ({ titulo, texto, foto: g.fotos?.[foto] ?? null })),
    informacoes: (g.informacoes ?? []).map(([titulo, texto]) => ({ titulo, texto })),
    utilidades: (g.utilidades ?? []).map(([titulo, texto]) => ({ titulo, texto })),
    regras: g.regras ?? [],
    transporte: g.transporte ? { aeroportos: (g.transporte.aeroportos ?? []).map(([titulo, texto]) => ({ titulo, texto })), local: g.transporte.local ?? null } : null,
    passeios: (g.passeios ?? []).map(([titulo, texto, endereco, gratis]) => ({ titulo, texto, endereco, gratis: Boolean(gratis), mapa: mapa(`${titulo}, ${endereco}`) })),
    restaurantes: (g.restaurantes ?? []).map(([titulo, refeicao, endereco]) => ({ titulo, refeicao, endereco, mapa: mapa(`${titulo}, ${endereco}`) })),
    contato: g.contato ?? null,
    avaliacao_url: g.avaliacao_url ?? null,
  };
}

// Texto curto com o link, para o e-mail e o WhatsApp da reserva confirmada
export function textoLinkGuia(base, token, nomeHotel) {
  return `Preparamos o guia da sua estadia no ${nomeHotel}: horários, Wi-Fi, como chegar, dicas da cidade e o pré-check-in, que libera a senha da porta do seu quarto:\n${linkGuia(base, token)}`;
}
