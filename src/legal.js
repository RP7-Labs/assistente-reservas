// Textos legais (privacidade, termos da reserva, consentimento da ficha, contrato de temporada) e provas de aceite.
// Cada texto é montado a partir do cadastro do hotel; a versão é o hash do texto exato que a pessoa viu.
// Cada aceite vira uma prova imutável (db/016): texto, IP, navegador, data e hash encadeado.
import crypto from "node:crypto";
import express from "express";
import { carregarHotel } from "./catalogo.js";
import { registrarTextoLegal, registrarProva } from "./store.js";

export const versao = (texto) => crypto.createHash("sha256").update(texto, "utf8").digest("hex").slice(0, 12);
export const hashTexto = (texto) => crypto.createHash("sha256").update(texto, "utf8").digest("hex");

export const ehTemporada = (hotel) => hotel.tipo === "temporada";
export const MAX_NOITES_TEMPORADA = 90; // Lei 8.245/1991, art. 48

const NI = "(não informado)";
const val = (v) => (v == null || String(v).trim() === "" ? NI : String(v).trim());
const br = (d) => (d ? d.split("-").reverse().join("/") : NI);
const reais = (v) => (v == null ? NI : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export function dadosEmpresa(hotel) {
  const e = hotel.empresa ?? {};
  return {
    nome_fantasia: hotel.nome,
    razao_social: e.razao_social ?? null, cnpj: e.cnpj ?? null, endereco: e.endereco ?? null,
    email: e.email ?? null, telefone: e.telefone ?? null,
    encarregado: { nome: e.encarregado?.nome ?? null, email: e.encarregado?.email ?? e.email ?? null },
  };
}

// O que falta no cadastro para os textos e a venda online ficarem completos. bloqueia = não vender online sem isso.
export function pendenciasLegais(hotel) {
  const e = dadosEmpresa(hotel);
  const p = [];
  const falta = (ok, campo, texto, bloqueia = false) => { if (!ok) p.push({ campo, texto, bloqueia }); };
  falta(e.razao_social, "empresa.razao_social", "Razão social de quem vende (Decreto 7.962/2013, art. 2º)", true);
  falta(/^\d{14}$|^\d{11}$/.test(String(e.cnpj ?? "").replace(/\D/g, "")), "empresa.cnpj", "CNPJ (ou CPF) de quem vende (Decreto 7.962/2013, art. 2º)", true);
  falta(e.endereco, "empresa.endereco", "Endereço físico de quem vende (Decreto 7.962/2013, art. 2º)", true);
  falta(e.email || e.telefone, "empresa.email", "E-mail ou telefone de contato");
  falta(e.encarregado.email, "empresa.encarregado", "Canal do encarregado de dados (LGPD, art. 41)");
  falta(String(hotel.cancelamento ?? "").trim().length >= 20, "cancelamento", "Política de cancelamento e reembolso (CDC, arts. 6º e 31)", true);
  if (ehTemporada(hotel)) {
    const t = hotel.temporada ?? {};
    falta(t.locador?.nome && t.locador?.documento, "temporada.locador", "Locador: nome e CPF/CNPJ (contrato de temporada)", true);
    falta(t.imovel?.endereco, "temporada.imovel", "Endereço do imóvel (contrato de temporada)", true);
    falta(Array.isArray(t.inventario) && t.inventario.length > 0, "temporada.inventario", "Móveis e utensílios e o estado de cada um (Lei 8.245/1991, art. 48, parágrafo único)", true);
    falta(Number(t.max_ocupantes) > 0, "temporada.max_ocupantes", "Número máximo de ocupantes");
  }
  return p;
}
export const podeVenderOnline = (hotel) => !pendenciasLegais(hotel).some((x) => x.bloqueia);

function identificacao(hotel) {
  const e = dadosEmpresa(hotel);
  return `${e.razao_social ?? hotel.nome}, CNPJ ${val(e.cnpj)}, ${val(e.endereco)}. Contato: ${[e.email, e.telefone].filter(Boolean).join(" · ") || NI}.`;
}

// ---- Política de privacidade (LGPD, arts. 6º, 9º e 18) ----
export function textoPrivacidade(hotel) {
  const e = dadosEmpresa(hotel);
  const temporada = ehTemporada(hotel);
  return `POLÍTICA DE PRIVACIDADE – ${hotel.nome}

1. Quem trata seus dados
Controlador: ${identificacao(hotel)}
Encarregado (DPO) e canal para pedidos sobre seus dados: ${e.encarregado.nome ? `${e.encarregado.nome}, ` : ""}${val(e.encarregado.email)}.

2. Quais dados, para quê e com qual base legal
- Reserva e pagamento: nome, e-mail, celular, datas, valores e forma de pagamento. Para fazer e cumprir a reserva (LGPD, art. 7º, V). Os dados do cartão são digitados no ambiente da adquirente (Getnet) e não ficam conosco; guardamos só os 4 últimos dígitos e a bandeira.
${temporada
    ? `- Contrato de locação por temporada e lista de ocupantes: nome, documento, nascimento, endereço e contato do locatário e dos ocupantes. Para firmar e cumprir o contrato (Lei 8.245/1991, arts. 48 a 50; LGPD, art. 7º, V) e para a segurança do imóvel e dos vizinhos (art. 7º, IX).`
    : `- Ficha de hóspedes (FNRH): nome, nascimento, nacionalidade, documento, gênero, cidade de residência, motivo da viagem e meio de transporte. É obrigação legal do meio de hospedagem (Lei 11.771/2008, art. 26), e a ficha é enviada ao Ministério do Turismo (LGPD, art. 7º, II).
- Cor ou raça e deficiência são dados sensíveis pedidos pela FNRH. Você pode responder "prefiro não informar". Quando informados, são tratados só para cumprir essa obrigação legal (LGPD, art. 11, II, "a").
- Crianças e adolescentes: os dados são informados pelo responsável e usados só para a hospedagem e para a ficha legal (LGPD, art. 14; ECA, art. 82).`}
- Assinatura eletrônica: imagem da assinatura, data, IP e navegador, para provar o aceite (LGPD, art. 7º, VI).
- Senha da porta: enviada por e-mail e WhatsApp para dar acesso ao quarto durante a estadia (art. 7º, V).
- Atendimento por chat e WhatsApp: mensagens trocadas, para responder e fazer a reserva (art. 7º, V).
- Anúncios (Meta e Google): só com o seu consentimento, dado no aviso de cookies ou na página de pagamento (art. 7º, I). Você pode recusar sem perder nada da reserva.
- Registros de acesso (IP, data e hora): guardados por 6 meses, como exige o Marco Civil da Internet (Lei 12.965/2014, art. 15).

3. Com quem compartilhamos
${temporada ? "" : "Ministério do Turismo (FNRH); "}Getnet (pagamento); Meta/WhatsApp e Resend (envio de mensagens e e-mails); TTLock (fechaduras); Supabase e Vercel (servidores do sistema). Não vendemos dados.

4. Transferência internacional
Parte desses fornecedores guarda ou processa dados fora do Brasil, inclusive nos Estados Unidos. Essa transferência é feita nas hipóteses do art. 33 da LGPD.

5. Por quanto tempo guardamos
- Reservas, pagamentos, ${temporada ? "contratos" : "fichas de hóspedes"} e provas de aceite: 5 anos depois da estadia (Código de Defesa do Consumidor, art. 27, e legislação fiscal), ou mais, se a lei exigir.
- Registros de acesso: no mínimo 6 meses (Marco Civil, art. 15).
- Conversas e contatos que não viraram reserva: até 12 meses depois do último contato.
- Consentimento para anúncios: até você retirar.

6. Seus direitos (LGPD, art. 18)
Você pode pedir confirmação de que tratamos seus dados, acesso, correção, anonimização ou eliminação do que não for obrigatório guardar, portabilidade, informação sobre compartilhamento e revogação do consentimento. Peça pelo canal do encarregado acima. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).

7. Segurança
Acesso só por pessoas autorizadas, com registro de quem fez o quê; tráfego criptografado (HTTPS); provas de aceite com código de integridade.

8. Cookies
Cookies de medição e anúncios só carregam se você aceitar no aviso do site. Sem aceite, o site funciona normalmente.`;
}

// ---- Termos da reserva (CDC; Decreto 7.962/2013) ----
export function textoTermosReserva(hotel) {
  const temporada = ehTemporada(hotel);
  return `TERMOS DA RESERVA – ${hotel.nome}

Vendedor: ${identificacao(hotel)}

1. O que está sendo contratado
${temporada ? "Locação por temporada do imóvel descrito no resumo, nas datas e para o número de pessoas indicados (Lei 8.245/1991, arts. 48 a 50). O contrato de locação é assinado no pré-check-in." : "Hospedagem no tipo de quarto, nas datas e para o número de pessoas indicados no resumo."} O valor total do resumo já inclui as taxas cobradas pelo ${temporada ? "locador" : "hotel"}.

2. Pagamento
Pix: pagamento à vista. Cartão: o valor total é pré-autorizado (fica reservado no limite do cartão) e é cobrado quando ${temporada ? "o locador" : "o hotel"} confirma; se a reserva for cancelada nas condições da política abaixo, a pré-autorização é liberada.

3. Política de cancelamento e reembolso
${val(hotel.cancelamento)}
Estas condições não afastam os direitos previstos no Código de Defesa do Consumidor.

4. Entrada, saída e regras
Entrada a partir das ${val(hotel.checkin)} e saída até as ${val(hotel.checkout)}. ${val(temporada ? hotel.temporada?.regras : hotel.politicas)}

${temporada
    ? `5. Ocupantes
Até ${val(hotel.temporada?.max_ocupantes)} pessoas. Os ocupantes são informados no pré-check-in.`
    : `5. Registro de hóspedes e menores
A lei exige a ficha de todos os hóspedes (FNRH, Lei 11.771/2008). Crianças e adolescentes só podem se hospedar acompanhados dos pais ou responsável, ou com autorização deles (ECA, art. 82). A autorização pode ser pedida na chegada.`}

6. Seus dados
Tratados conforme a Política de Privacidade, disponível em /privacidade.

7. Confirmação
Você recebe a confirmação e uma cópia destes termos por e-mail. Para dúvidas, reclamações ou cancelamento, use o contato acima.`;
}

// ---- Consentimento da ficha (check-in) ----
export function textoConsentimentoFicha(hotel) {
  return ehTemporada(hotel)
    ? "Declaro que as informações dos ocupantes são verdadeiras e que li e aceito o contrato de locação por temporada acima. Autorizo o uso destes dados para o contrato e para a minha estadia, e o envio de mensagens sobre a reserva (incluindo a senha de acesso) por e-mail e WhatsApp, conforme a Política de Privacidade."
    : "Declaro que as informações são verdadeiras. Sei que estes dados são enviados à Ficha Nacional de Registro de Hóspedes por exigência legal (Lei 11.771/2008) e autorizo o envio de mensagens sobre a minha hospedagem (incluindo a senha da porta) por e-mail e WhatsApp, conforme a Política de Privacidade.";
}

export const textoDeclaracaoMenores = "Declaro, como titular da reserva, que cada menor de idade informado está acompanhado dos pais ou do responsável legal, ou tem autorização escrita deles, que apresentarei se for pedida (ECA, art. 82).";

// ---- Contrato de locação por temporada (Lei 8.245/1991, arts. 48 a 50) ----
export function textoContratoTemporada(hotel, { reserva, valor, hospedes }) {
  const t = hotel.temporada ?? {};
  const tit = hospedes?.[0] ?? {};
  const inventario = (t.inventario ?? []).map((i) => `- ${i.quantidade ?? 1} × ${i.item} – estado: ${val(i.estado)}`).join("\n") || NI;
  const ocupantes = (hospedes ?? []).map((h, i) => `${i + 1}. ${h.nome} – ${h.documento_tipo ?? "documento"} ${h.documento_numero ?? NI} – nascimento ${br(h.nascimento)}`).join("\n");
  return `CONTRATO DE LOCAÇÃO POR TEMPORADA
Reserva ${reserva.codigo_motor}

LOCADOR: ${val(t.locador?.nome)}, CPF/CNPJ ${val(t.locador?.documento)}${t.locador?.endereco ? `, ${t.locador.endereco}` : ""}.
LOCATÁRIO: ${val(tit.nome)}, ${tit.documento_tipo ?? "documento"} ${val(tit.documento_numero)}, residente em ${val([tit.cidade, tit.uf, tit.pais_residencia].filter(Boolean).join(" – "))}, e-mail ${val(tit.email)}, celular ${val(tit.telefone)}.

1. Imóvel: ${val(t.imovel?.endereco)}. ${t.imovel?.descricao ?? ""}
2. Finalidade: residência temporária para lazer ou outra finalidade de curta duração (Lei 8.245/1991, art. 48).
3. Prazo: entrada em ${br(reserva.checkin)} a partir das ${val(hotel.checkin)} e saída em ${br(reserva.checkout)} até as ${val(hotel.checkout)}. O prazo não passa de ${MAX_NOITES_TEMPORADA} dias.
4. Aluguel: ${reais(valor)} pelo período, pago antecipadamente (art. 49).${t.caucao ? ` Caução: ${t.caucao}.` : ""}
5. Ocupantes (no máximo ${val(t.max_ocupantes)}):
${ocupantes || NI}
6. Móveis e utensílios que guarnecem o imóvel e o estado em que se encontram (art. 48, parágrafo único):
${inventario}
7. Regras da casa: ${val(t.regras)}
8. Cancelamento: ${val(hotel.cancelamento)}
9. O LOCATÁRIO devolve o imóvel no estado em que recebeu e responde pelos danos causados durante a estadia, salvo o desgaste normal de uso. Pessoas além das listadas só com autorização do LOCADOR.
10. Dados pessoais tratados conforme a Política de Privacidade do LOCADOR.
11. As partes admitem a assinatura eletrônica deste contrato (MP 2.200-2/2001, art. 10, § 2º, e Lei 14.063/2020). O LOCADOR aderiu a estas condições ao cadastrá-las no sistema; o LOCATÁRIO assina no pré-check-in.`;
}

// ---- Provas ----
export const ipDe = (req) => String(req.get?.("x-forwarded-for") ?? req.ip ?? "").split(",")[0].trim().slice(0, 64) || null;
export const agenteDe = (req) => String(req.get?.("user-agent") ?? "").slice(0, 300) || null;

// Grava o texto (uma vez por versão) e a prova do aceite
export async function provar(req, { tipo, referencia, titular = null, textoTipo = tipo, texto = null, dados = null }) {
  const texto_hash = texto ? await registrarTextoLegal(textoTipo, texto) : null;
  return registrarProva({ tipo, referencia, titular, texto_hash, dados, ip: req ? ipDe(req) : null, agente: req ? agenteDe(req) : null });
}

// ---- Rotas públicas: textos atuais (para as páginas /privacidade e /termos) ----
export const legal = express.Router();
legal.get("/:doc", (req, res) => {
  const hotel = carregarHotel();
  const gerar = { privacidade: textoPrivacidade, termos: textoTermosReserva }[req.params.doc];
  if (!gerar) return res.status(404).json({ erro: "Documento não encontrado." });
  const texto = gerar(hotel);
  res.json({ hotel: hotel.nome, texto, versao: versao(texto), empresa: dadosEmpresa(hotel) });
});
