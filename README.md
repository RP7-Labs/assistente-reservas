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
cp .env.example .env   # preencher ANTHROPIC_API_KEY
npm install
npm start              # http://localhost:3000
npm test               # testa a lógica de quarto/link sem chamar a IA
```

## Publicar (Supabase + Vercel, planos gratuitos)
1. **Supabase**: no projeto (novo ou existente), abra o SQL Editor e rode `db/schema.sql`. Tudo fica no schema `reservas`, sem misturar com outro projeto.
2. Em **Project Settings > API > Exposed schemas**, adicione `reservas`.
3. **Vercel**: importe este repositório (Framework: Other) e cadastre as variáveis do `.env.example`: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `PUBLIC_URL` (a URL que a Vercel gerar).
4. Abra a URL: o chat aparece na página inicial e as métricas ficam em `/api/metricas`.

Sem as variáveis do Supabase, o app grava em `data/local.json`, o que serve para rodar localmente.

## Configurar para o hotel do Joel
Edite `data/hotel.json`: quartos reais, capacidades, preços "a partir de" e `motor.link_modelo` com o formato do link da Gasystem (abrir uma reserva no site e copiar a URL já mostra o padrão).

## Próximos passos
1. Pegar com o Joel os quartos reais e um link de reserva da Gasystem.
2. Publicar (Vercel/VPS) e conectar um número de WhatsApp de teste (WhatsApp Cloud API).
3. Cruzar os leads com o relatório de reservas da Gasystem para medir conversão e comissão economizada.
4. Pagamento embutido (PIX/cartão com split) na fase 2.
