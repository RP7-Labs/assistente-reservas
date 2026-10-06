// Canais externos por iCal: sincroniza os calendários e monta o calendário exportado de cada anúncio.
import { carregarHotel } from "./catalogo.js";
import { listarCanais, salvarCanal, trocarBloqueios, listarBloqueios, listarDados, buscarCanalPorToken } from "./store.js";
import { baixarBloqueios, gerarIcal, intervalos, noitesFechadas } from "./ical.js";
import { hojeSP } from "./regras.js";

// Intervalo mínimo entre leituras automáticas do mesmo calendário
export const MINUTOS_SYNC = Number(process.env.ICAL_MINUTOS || 10);

// Antes da migração 006 as tabelas não existem: segue sem bloqueios em vez de quebrar o checkout
export const bloqueiosOuNada = () => listarBloqueios().catch(() => []);

export async function sincronizarCanal(canal, { hoje = hojeSP(), buscarFn = fetch } = {}) {
  const agora = new Date().toISOString();
  if (!canal.url_importar) return { id: canal.id, ok: true, bloqueios: 0, aviso: "sem link para importar" };
  try {
    const bloqueios = await baixarBloqueios(canal, hoje, buscarFn);
    await trocarBloqueios(canal.id, bloqueios);
    await salvarCanal({ ...canal, ultimo_sync: agora, erro: null });
    return { id: canal.id, ok: true, bloqueios: bloqueios.length };
  } catch (err) {
    // Mantém os bloqueios anteriores: um calendário fora do ar não pode liberar datas vendidas
    await salvarCanal({ ...canal, ultimo_sync: agora, erro: err.message.slice(0, 300) });
    return { id: canal.id, ok: false, erro: err.message };
  }
}

// Sincroniza os canais. Sem `forcar`, só os que estão há mais de MINUTOS_SYNC sem leitura.
export async function sincronizarCanais({ forcar = false, agora = new Date(), ...opts } = {}) {
  const canais = await listarCanais().catch(() => []);
  const limite = agora.getTime() - MINUTOS_SYNC * 60_000;
  const vencidos = canais.filter((c) => forcar || !c.ultimo_sync || Date.parse(c.ultimo_sync) < limite);
  return Promise.all(vencidos.map((c) => sincronizarCanal(c, opts)));
}

// Calendário que o anúncio importa: noites em que o tipo de quarto está lotado por outros canais
export async function calendarioExportado(token, hoje = hojeSP()) {
  const canal = token && (await buscarCanalPorToken(token));
  if (!canal) return null;
  const hotel = carregarHotel();
  const quarto = hotel.quartos.find((q) => q.id === canal.quarto_id);
  if (!quarto) return null;
  const [{ reservas }, bloqueios] = await Promise.all([listarDados(), bloqueiosOuNada()]);
  const fechadas = noitesFechadas({ quarto, reservas, bloqueios, canalId: canal.id, hoje });
  return gerarIcal({ nome: `${hotel.nome} · ${canal.nome}`, fechados: intervalos(fechadas) });
}
