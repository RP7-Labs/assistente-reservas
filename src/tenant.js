// Hotel da requisição atual (multi-tenant). Cada pedido HTTP, webhook ou tarefa agendada roda
// "dentro" de um hotel; o store filtra e grava tudo com esse hotel_id.
import { AsyncLocalStorage } from "node:async_hooks";

const contexto = new AsyncLocalStorage();

// Hotel usado quando nada indica outro (o hotel piloto e os dados anteriores à migração 011)
export const HOTEL_PADRAO = process.env.HOTEL_PADRAO || "principal";
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export const hotelId = () => contexto.getStore()?.id ?? HOTEL_PADRAO;

// Roda fn com o hotel id. Use noHotel (catalogo.js), que também carrega a configuração.
export const rodarNoHotel = (id, fn) => contexto.run({ id }, fn);

// Chaves de integração (Getnet, WhatsApp, TTLock, FNRH, Meta...): as variáveis de ambiente valem só
// para o hotel padrão. Os outros hotéis usam as próprias chaves, guardadas no cadastro do hotel;
// sem elas, cada integração fica no modo simulado, e nenhum hotel usa a conta de outro.
const chaves = new Map();
export const definirChavesDoHotel = (id, env) => chaves.set(id, env ?? {});
export const envDoHotel = () => (hotelId() === HOTEL_PADRAO ? process.env : (chaves.get(hotelId()) ?? {}));

// Simulação (checkout sem cobrança, senha que não vai para a fechadura, FNRH não enviada) só fora do ar:
// em produção na Vercel fica desligada, a menos que SIMULACAO=1. Fora da Vercel (testes, máquina local) fica ligada,
// a menos que SIMULACAO=0.
export const simulacaoPermitida = () => (process.env.SIMULACAO ? process.env.SIMULACAO === "1" : process.env.VERCEL_ENV !== "production");
