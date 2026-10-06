# Assistente de Reservas (piloto)

Assistente com IA (Claude) que atende o hóspede no site e no WhatsApp e leva até o link de reserva **do quarto que ele escolheu**, no canal direto do hotel.

## O que já faz
- Entende tipo de quarto, datas e número de pessoas, e pergunta só o que falta.
- Gera o link do motor de reservas pelo catálogo, nunca "de cabeça". Pediu estúdio, recebe o link do estúdio.
- Valida datas e capacidade e sugere outro quarto só quando o pedido não cabe.
- Cada link é rastreável (`/r/<id>`, com UTM): conta links gerados, cliques e o quarto mais pedido em `/api/metricas`.
- Passa a conversa para um atendente humano quando o assunto não é reserva.
- Funciona sem API da Gasystem: só precisa do formato do link do motor.

## Rodar
```bash
cp .env.example .env   # ANTHROPIC_API_KEY é opcional
npm install
npm start              # http://localhost:3000
npm test               # testa a lógica de quarto/link sem chamar a IA
```

## Publicar (Supabase + Vercel, planos gratuitos)
1. **Supabase**: no projeto (novo ou existente), abra o SQL Editor e rode `db/schema.sql`, depois `db/002_backoffice.sql` e `db/003_admins.sql`. Tudo fica no schema `reservas`, sem misturar com outro projeto.
2. Em **Project Settings > API > Exposed schemas**, adicione `reservas`.
3. **Vercel**: importe este repositório (Framework: Other) e cadastre as variáveis do `.env.example`: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_URL` (a URL que a Vercel gerar), `ADMIN_EMAIL` (seu e-mail, o primeiro admin) e `SESSION_SECRET` (um texto aleatório longo).
4. Abra a URL: o chat aparece na página inicial, as métricas ficam em `/api/metricas` a saúde dos serviços em `/status` e o back-office em `/admin`.

Sem as variáveis do Supabase, o app grava em `data/local.json`, o que serve para rodar localmente.

## Back-office (`/admin`)
Cada pessoa tem seu login. Quem não tem acesso usa "Pedir acesso", e qualquer admin aprova, recusa ou revoga na aba **Usuários**. O admin principal é quem se cadastra com o e-mail de `ADMIN_EMAIL`: entra aprovado e não pode ser recusado nem revogado (rode antes `db/003_admins.sql`).
- **Visão geral**: atendimentos, links gerados e clicados, reservas, conversão, receita e comissão economizada.
- **Atendimentos**: todas as conversas, com destaque para as que pediram um atendente humano.
- **Locações**: o funil de cada link (enviado, clicou, confirmada, concluída, cancelada). Ao confirmar na Gasystem, registre o código e o valor. Reservas de outros canais podem ser lançadas à mão.
- **Quartos**: ocupação e quartos livres por data, com base nas reservas registradas (o número de quartos de cada tipo fica em `unidades`, no `data/hotel.json`).

## Configurar para o hotel do Joel
Edite `data/hotel.json`: quartos reais, capacidades, preços "a partir de" e `motor.link_modelo` com o formato do link da Gasystem (abrir uma reserva no site e copiar a URL já mostra o padrão).

## Próximos passos
1. Pegar com o Joel os quartos reais e um link de reserva da Gasystem.
2. Publicar (Vercel/VPS) e conectar um número de WhatsApp de teste (WhatsApp Cloud API).
3. Cruzar os leads com o relatório de reservas da Gasystem para medir conversão e comissão economizada.
4. Pagamento embutido (PIX/cartão com split) na fase 2.

## Modo sem IA (regras)

Sem `ANTHROPIC_API_KEY`, o chat funciona por regras (`src/regras.js`), sem custo: entende quarto (nome e apelidos do `data/hotel.json`), datas ("10/10", "dia 12", "de 3 a 5 de janeiro", "amanhã", "sexta"), noites e pessoas ("casal", "2 adultos e 1 criança"), pergunta só o que falta e gera o mesmo link rastreável. Pedidos de atendente, eventos, grupos e reclamações vão para o back-office. Responde ainda preço, quartos e políticas. Com a chave, passa a usar o Claude; `ASSISTENTE_MODO=regras` força o modo sem IA.

## Datas por feriado

No modo por regras, citar um feriado ou período ("natal", "réveillon", "carnaval", "semana santa", "corpus christi", "tiradentes", "finados", "fim de semana"...) faz o assistente sugerir 2 ou 3 opções de entrada e saída. No chat web elas viram botões; no WhatsApp, o hóspede responde com o número. Carnaval, Páscoa e Corpus Christi são calculados a partir da data da Páscoa; feriados fixos emendam com o fim de semana (`src/periodos.js`).

## Checkout de pagamento (simulado)

O link do chat (`/r/:id`) leva para `/pagamento`, onde o hóspede confirma os dados e paga:

- **Cartão de crédito**: pré-autorização do valor total. No back-office (aba Pagamentos) o hotel **captura** (cobra) ou **libera** (cancela a reserva). Cartão de teste aprovado: 4111 1111 1111 1111; recusado: 4000 0000 0000 0002. O número do cartão nunca é gravado, só os 4 últimos dígitos.
- **Pix**: gera um código copia e cola de teste e um botão "Simular pagamento recebido".

Pagamento aprovado vira reserva confirmada (código `P-XXXXXX`) e manda dois e-mails: pagamento confirmado (ou pré-autorização aprovada, no cartão) e reserva confirmada. Capturar o cartão manda "pagamento confirmado"; liberar manda o aviso de cancelamento. `CHECKOUT_MODO=motor` volta a mandar o link para o motor de reservas.

**Lembrete por e-mail:** quem preenche os dados e não paga em 5 minutos recebe o link de pagamento por e-mail (uma vez).

- Sem `RESEND_API_KEY` e `EMAIL_FROM`, os e-mails ficam só registrados no back-office (simulado).
- Para agendar na Vercel: defina `CRON_SECRET`, rode `db/004_pagamentos.sql` e depois `db/005_cron_lembretes.sql` (pg_cron do Supabase chama `/api/tarefas/lembretes` a cada minuto). Localmente, o `npm start` já roda os lembretes sozinho.

## Dúvidas do hotel (RAG local, sem custo)

As respostas sobre o hotel ficam em `data/conhecimento.md`, uma seção `##` por assunto, com uma linha `Perguntas:` com jeitos diferentes de perguntar. O assistente busca a seção mais parecida (BM25, sem IA e sem custo) e responde com o texto dela. Para mudar uma resposta, basta editar o arquivo. Se nada parecido for encontrado, ele oferece chamar um atendente.

## Botões no chat

Cada passo da conversa vem com opções para tocar: menu inicial, quarto, data de entrada (hoje, amanhã, fim de semana ou calendário), noites, pessoas (respeitando a capacidade do quarto), datas de feriado e lista de dúvidas. No WhatsApp, até 3 opções viram botões e até 10 viram uma lista; datas são digitadas.

## IA gratuita (Gemini ou Groq)

Para uma conversa mais livre sem pagar, coloque na Vercel `LLM_API_KEY` (e `LLM_PROVEDOR=groq` se for Groq; o padrão é Gemini). A chave grátis sai em [aistudio.google.com](https://aistudio.google.com/apikey) (Gemini) ou [console.groq.com](https://console.groq.com/keys) (Groq).

- Usa as mesmas ferramentas do modo Claude: o link só sai depois de validar quarto, datas e capacidade, e pedidos de atendente vão para o back-office.
- As dúvidas usam a base `data/conhecimento.md` (a seção mais parecida vai junto da mensagem) e as datas de feriado são calculadas pelo servidor.
- Os botões continuam: a IA termina a mensagem com `[opções: A | B]`, que o chat transforma em botões.
- Se a IA falhar ou demorar (limite do plano grátis, rede), aquela mensagem é respondida pelas regras.
- Prioridade: `ANTHROPIC_API_KEY` (Claude) > `LLM_API_KEY` (grátis) > regras. `ASSISTENTE_MODO=regras|gratis|ia` força um modo.
- Atenção: no plano grátis do Gemini, o Google pode usar as conversas para melhorar os produtos dele. Use só para testes, sem dados reais de hóspedes.

## Airbnb e outros canais (iCal)

A API do Airbnb só é liberada para parceiros convidados, então a integração usa a sincronização de calendário por iCal, que todo anfitrião tem.

1. Rode `db/006_canais_ical.sql` no Supabase.
2. No back-office, aba **Canais**: cole o link de *Exportar calendário* do anúncio e escolha o tipo de quarto. Cada anúncio ocupa uma unidade desse tipo.
3. Copie o "Link para o canal importar" e cole em *Importar calendário* no Airbnb.

- **Airbnb → aqui:** reservas e bloqueios do anúncio ocupam a unidade e saem da venda. Lemos a cada `ICAL_MINUTOS` (padrão 10) pelo mesmo pg_cron dos lembretes e de novo antes de cada pagamento. Se o Airbnb sair do ar, os bloqueios anteriores ficam.
- **Aqui → Airbnb:** `/api/ical/<token>.ics` publica as noites em que o tipo de quarto lota (reservas daqui e de outros canais). O Airbnb lê esse link no ritmo dele.
- Limites do iCal: não traz preço nem dados do hóspede, e a leitura do lado do Airbnb não é imediata, então há uma janela pequena de reserva dupla.
