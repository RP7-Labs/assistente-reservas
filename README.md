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

## Checkout de pagamento (simulado ou Getnet)

O link do chat (`/r/:id`) leva para `/pagamento`, onde o hóspede confirma os dados e paga:

- **Cartão de crédito**: pré-autorização do valor total. No back-office (aba Pagamentos) o hotel **captura** (cobra) ou **libera** (cancela a reserva). Cartão de teste aprovado: 4111 1111 1111 1111; recusado: 4000 0000 0000 0002. O número do cartão nunca é gravado, só os 4 últimos dígitos.
- **Pix**: gera um código copia e cola de teste e um botão "Simular pagamento recebido".

Pagamento aprovado vira reserva confirmada (código `P-XXXXXX`) e manda dois e-mails: pagamento confirmado (ou pré-autorização aprovada, no cartão) e reserva confirmada. Capturar o cartão manda "pagamento confirmado"; liberar manda o aviso de cancelamento. `CHECKOUT_MODO=motor` volta a mandar o link para o motor de reservas.

**Getnet (cobrança real):** com `GETNET_CLIENT_ID`, `GETNET_CLIENT_SECRET` e `GETNET_SELLER_ID` (credenciais da API v2, pedidas ao gerente Getnet/Santander) o checkout passa a cobrar de verdade. Rode `db/009_getnet.sql`.

- **Cartão**: abre o Checkout Iframe da Getnet. O número do cartão é digitado no ambiente da Getnet e nunca passa pelo nosso servidor (fica fora do escopo PCI). Usa pré-autorização (`GETNET_PRE_AUTORIZACAO=0` cobra direto). Capturar/liberar no back-office chama a Getnet.
- **Pix**: QR Code gerado pela API da Getnet, válido por 30 minutos. A página confirma sozinha quando o pagamento chega.
- **Confirmação**: só pela notificação da Getnet, nunca pelo navegador. Defina `GETNET_SEGREDO_NOTIFICACAO` (texto longo aleatório) e peça ao suporte da Getnet para cadastrar as URLs de notificação de Pix e de cartão como `https://SEU-DOMINIO/api/pagamento/getnet/notificacao/<segredo>`. Vendedor, pedido e valor são conferidos com o banco.
- `GETNET_AMBIENTE`: `sandbox`, `homologacao` (padrão) ou `producao`. `GETNET_CANAL` é o código do header `x-transaction-channel-entry`, se a Getnet exigir. Cartões de teste: 5155 9012 2228 0001 aprova; 5155 9012 2223 0006 recusa.
- Os e-mails só deixam de dizer "ambiente de testes" com `GETNET_AMBIENTE=producao`.

**Lembrete por e-mail:** quem preenche os dados e não paga em 5 minutos recebe o link de pagamento por e-mail (uma vez).

- Sem `RESEND_API_KEY` e `EMAIL_FROM`, os e-mails ficam só registrados no back-office (simulado).
- Para agendar na Vercel: rode `db/004_pagamentos.sql` e `db/005_cron_lembretes.sql` (pg_cron do Supabase chama `/api/tarefas/lembretes` a cada minuto). Defina `CRON_SECRET` na Vercel e o mesmo valor no Vault do Supabase com `select vault.create_secret('VALOR', 'cron_secret');`. Localmente, o `npm start` já roda os lembretes sozinho.

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

## Check-in digital, FNRH e senhas da porta

1. Rode `db/007_checkin.sql` no Supabase.
2. Back-office, aba **Check-in**: cadastre as unidades (101, 102...) com o tipo de quarto e, se houver, o ID da fechadura TTLock.
3. Quando a reserva é paga, o e-mail de confirmação leva o link `/checkin?c=<token>`. O hóspede preenche a ficha de todos (campos e códigos da FNRH Digital) e recebe o quarto e a senha da porta, válida só do horário de check-in ao de check-out.

- **Senhas:** com `TTLOCK_*` configurado, a senha é gravada na fechadura pela API aberta da TTLock (precisa de gateway Wi-Fi). Funciona também com contas do TTHotel: `TTLOCK_CLIENT_ID` e `TTLOCK_CLIENT_SECRET` ficam em Configurações > Integração do TTHotel, e `TTLOCK_USERNAME`/`TTLOCK_PASSWORD` são a conta onde as fechaduras estão. Na aba Check-in, a lista "Fechaduras da conta" mostra cada fechadura, bateria e gateway, e liga a fechadura à unidade. Sem isso, é simulada. Reserva cancelada, no-show ou pré-autorização liberada apaga a senha.
- **FNRH Digital:** com `FNRH_*` configurado, a ficha vai para o governo (`POST /hospedagem/registrar`) quando o hóspede conclui o check-in. A saída é registrada no horário de check-out, e cancelamento e no-show também são enviados. A entrada é manual no back-office, ou automática com `FNRH_ENTRADA_AUTOMATICA=1`. Comece em `FNRH_AMBIENTE=homologacao`.
- A documentação da API não diz como a "chave de API" vira o usuário e a senha do Basic Auth, nem qual situação inicial o PMS deve mandar (`FNRH_SITUACAO_INICIAL`, padrão `PRECHECKIN_REALIZADO`). Confirme os dois na homologação.

## Tráfego pago até o assistente

1. Rode `db/008_origens.sql` no Supabase.
2. Aba **Campanhas**: gere o link do anúncio (UTM) e use-o como URL final no Google Ads ou na Meta. O chat guarda a campanha, o `gclid`/`fbclid` e o cookie `_fbp`, e manda tudo junto com a primeira mensagem. Anúncios de clique para o WhatsApp chegam com o `ctwa_clid`.
3. Conversões:
   - **Meta:** `InitiateCheckout` e `Purchase` pela API de Conversões (servidor), mais o Pixel no navegador com o mesmo `event_id`, para não contar em dobro. Conversa vinda de anúncio de WhatsApp vai como `business_messaging`.
   - **Google Ads:** a tag de conversão dispara no pagamento aprovado (`transaction_id` = código da reserva). O botão "Baixar conversões para o Google Ads" gera o CSV de conversões offline por `gclid`.
4. As tags só carregam depois do aceite de cookies (LGPD). Quem recusa continua com a origem guardada no servidor, mas sem Pixel nem tag.

A aba mostra conversas, links, reservas pagas e receita por origem e campanha.

## Leads dos formulários da Meta no WhatsApp

Quem preenche o formulário de um anúncio da Meta (Lead Ads) recebe uma mensagem do assistente no WhatsApp em segundos. As respostas do formulário (datas, tempo de estadia, motivo) entram na conversa, e o assistente não pergunta de novo. Lead corporativo vai direto para um atendente.

1. Rode `db/010_leads_meta.sql`.
2. No WhatsApp Manager, crie e aprove um **modelo de mensagem** (categoria Marketing ou Utilidade) com `{{1}}` = primeiro nome. Ex.: "Olá, {{1}}! Aqui é do Rezende Suítes. Vi seu interesse no anúncio. Para quando você pensa em vir e por quanto tempo?". Coloque o nome em `WHATSAPP_MODELO_LEAD` e o texto em `WHATSAPP_MODELO_LEAD_TEXTO` (só para o histórico).
3. No app da Meta, assine o campo **leadgen** da página com a URL `https://SEU-DOMINIO/webhook/meta-leads` e o token `META_LEADS_VERIFY_TOKEN` (ou o mesmo `WHATSAPP_VERIFY_TOKEN`).
4. Defina `META_PAGE_TOKEN` (token da página com `leads_retrieval`) e `META_APP_SECRET` (confere a assinatura do webhook).
5. Teste com a [ferramenta de teste de Lead Ads](https://developers.facebook.com/tools/lead-ads-testing) ou com "Simular um lead" na aba Campanhas.

A reserva paga desse lead volta para a Meta como evento de CRM com o `lead_id` (Conversion Leads), para a campanha otimizar por quem reserva, não por quem preenche formulário.

**Estadia mensal:** quarto com `preco_mensal` em `data/hotel.json` cobra o preço do mês a partir de `minimo_noites_mensal` noites (padrão 28). O chat entende "1 mês", "2 meses" e "mensal".

## Vários hotéis e países

O sistema atende vários hotéis no mesmo deploy, cada um com os próprios dados, usuários e configuração, e quatro países: Brasil, Argentina, Paraguai e Estados Unidos (`src/paises.js`: idioma, moeda, fuso, documento do hóspede e meio de pagamento padrão).

- **Migração:** rode `db/011_multihotel.sql` e `db/012_permissoes.sql` no Supabase logo depois do deploy. Ela cria a tabela `hoteis` e a coluna `hotel_id` em todas as tabelas; os dados atuais ficam no hotel `principal`.
- **Qual hotel:** domínio cadastrado no hotel, ou `?hotel=<id>` no link do chat, do pagamento e do back-office. Links com id próprio (pagamento, check-in, calendário iCal, `/r/:id`) acham o hotel sozinhos. WhatsApp e leads da Meta acham o hotel pelo `whatsapp_phone_number_id` e pelo `meta_page_id` em `config.integracoes`.
- **Admins da plataforma** (`PLATAFORMA_EMAILS`, ou o `ADMIN_EMAIL`) veem a aba Hotéis, criam hotéis e trocam de hotel pelo seletor. O admin de um hotel só vê o próprio hotel.
- **Chaves:** as variáveis de ambiente (Getnet, WhatsApp, Meta, TTLock, FNRH) valem só para o hotel `principal`. Outros hotéis ficam simulados até a fase de chaves por hotel. Getnet e FNRH só ligam para hotéis do Brasil.

Plano das próximas fases em `/mnt/project-files/avaliacoes/plano-multitenant.md`.

## Guia da estadia (`/estadia?c=<token>`)

Página pessoal do hóspede, pensada para o celular, com o mesmo token do pré-check-in. Mostra nome, datas, quarto, contagem até a chegada e, depois do pré-check-in, o número do quarto e a senha da porta. Traz também check-in e check-out, Wi-Fi com botão de copiar, regras, estrutura com fotos, como chegar, passeios e restaurantes com link para o Google Maps, contato pelo WhatsApp e avaliação no Google.

- O link vai no e-mail da reserva confirmada e, para quem reservou pelo WhatsApp, na mesma conversa. No back-office, a aba Check-in copia ou reenvia o link.
- O conteúdo é a chave `guia` do hotel (`data/hotel.json` no hotel principal, `config.guia` nos outros). Fotos em `public/guia/<hotel>/`.
- A senha do Wi-Fi vem de `guia.wifi.senha` ou da variável `WIFI_SENHA`, para não ficar no repositório.
- Estacionamento usa o valor da alta temporada (dezembro a março, ou `guia.meses_alta`) pela data de entrada.

## Site do hotel (/site)

- Página montada no servidor a partir do bloco `site` do `hotel.json` (textos, quartos, dúvidas), do catálogo e do `guia` (fotos, contato).
- Botão "Reservar" e formulário de datas abrem o assistente numa gaveta, já com a pergunta da pessoa.
- Rastreio: a origem da visita (UTM, gclid, fbclid, site de origem) fica no navegador e vai com a primeira mensagem do chat. O botão de WhatsApp leva um código (`cód. RSxxxxx`) que liga a conversa do WhatsApp à origem da visita. As visitas por origem aparecem na aba Campanhas. `GTM_ID` liga o Google Tag Manager depois do consentimento.
- Migração: `db/013_site_senhas.sql` (visitas e senhas em várias fechaduras).

## Senha da porta

- O hóspede digita os números e termina com `#` (`guia.teclado_sufixo` no `hotel.json`).
- Cadastre a fechadura da entrada do hotel como unidade do tipo "Entrada do hotel": a mesma senha do quarto é criada nela também, com a mesma validade, e apagada junto.

### Envio da senha (e-mail e WhatsApp) e horário

- Rode `db/015_checkin_assinatura.sql` no Supabase.
- Admin, aba **Check-in**, quadro **Envio da senha**: "assim que o hóspede concluir o check-in" (padrão) ou "X horas antes do horário de check-in" (0 a 168). Agendada, a senha sai pela tarefa de minuto (`/api/tarefas/lembretes`).
- A senha vai por e-mail e direto no WhatsApp do hóspede. O resultado de cada envio aparece na ficha do admin.
- Fora da janela de 24h da Meta, o WhatsApp só entrega mensagem de **modelo aprovado**. Crie no WhatsApp Manager um modelo (categoria Utilidade) e coloque o nome em `WHATSAPP_MODELO_SENHA` (idioma em `WHATSAPP_MODELO_IDIOMA`, padrão `pt_BR`). Texto sugerido, com 4 variáveis na ordem nome, quarto, senha, validade:

  > Olá, {{1}}! Seu check-in está pronto. Quarto {{2}}. Senha da porta: {{3}} (digite os números e termine com #). Válida {{4}}.

  Sem o modelo, vai como texto simples, que só chega se o hóspede tiver falado com o hotel nas últimas 24h.

### Leitura de documento e assinatura

- **Leitura de documento:** no check-in, o botão "Ler documento" abre a câmera e lê as linhas `<<<` do passaporte ou da nova Carteira de Identidade (CIN). O OCR (Tesseract.js) roda no celular: a foto não vai para o servidor. Só preenche campos cujos dígitos verificadores conferem; na CIN, o CPF entra só se for válido. RG antigo e CNH não têm essas linhas: o hóspede digita.
- **Assinatura:** o titular assina com o dedo antes de concluir. Fica guardada a imagem, a data, IP, navegador e um código SHA-256 da imagem junto com a ficha (assinatura eletrônica simples, Lei 14.063/2020). O admin mostra a assinatura na ficha.

## Resultados de marketing (`/resultados`)

Painel para saber quanto cada canal e campanha investiu, vendeu e deixou de margem. Fica no admin, em **Resultados**, e só abre com login. Ele não muda nada nas campanhas: só mostra números, alertas e recomendações, e quem decide e mexe no Google ou na Meta é uma pessoa.

- **De onde vêm os dados.** Hoje por importação de CSV, na aba Importações, sempre com prévia antes de gravar:
  - Google Ads: Campanhas, segmentado por Dia;
  - Meta Ads: Detalhamento por Dia;
  - relatório de reservas do PMS ou do motor.
- **Reimportar não duplica.** Reimportar o mesmo período atualiza as linhas. Cada importação fica no histórico e na auditoria.
- **Atribuição.** Usa a origem rastreada (UTM, gclid, fbclid, código do WhatsApp do site) da conversa que virou reserva.
  - Reserva sem origem confiável fica como "Origem desconhecida".
  - Reserva do PMS usa a coluna Canal (OTA ou direto).
  - Reservas do sistema e do PMS são conciliadas pelo código e, se não houver, por datas e valor.
- **Regras que o painel segue:**
  - cada reserva conta uma vez;
  - reserva cancelada ou no-show não é receita;
  - as conversões que Google e Meta informam aparecem separadas e nunca somadas.
- **Custos, metas e ferramentas.** Ficam nas abas do painel e toda mudança vai para a auditoria.
  - Os custos (comissão OTA, taxa de pagamento, impostos, custo por noite) são estimativas: confirme com a contabilidade.
  - O teto de custo por reserva sai da margem.
  - O orçamento de ferramentas tem limite de R$ 500/mês.
- **Banco.** Precisa da migração `db/014_resultados.sql`.

UTMs para ligar campanha a reserva (use o id da campanha):
- Google Ads, sufixo do URL final: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}` (deixe o tagueamento automático ligado para o gclid)
- Meta Ads, parâmetros de URL: `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}`

## Produção sem simulação (`SIMULACAO`)

Na Vercel em produção nada é simulado: integração sem chave fica desligada.
- **Pagamento.** A página manda o hóspede para o WhatsApp do hotel.
- **Senha da porta.** Não é gerada; a recepção entrega.
- **Ligar a simulação.** `SIMULACAO=1` liga de volta (por exemplo, numa demonstração). Fora da Vercel (testes, máquina local) a simulação fica ligada, a menos que `SIMULACAO=0`.
- **Testar as chaves.** No admin, Visão geral, quadro Integrações, o botão "Testar" faz uma chamada real sem efeito.
  - Getnet: pede o token.
  - TTLock: lista as fechaduras.
  - WhatsApp: lê o número.
  - Resend: lê os domínios.

## Catálogo e preços (admin > Quartos)

- **Onde fica.** Tipos de quarto, unidades, diária, preço mensal, políticas e link do motor ficam no cadastro do hotel (tabela `hoteis`, campo `config`), que sobrepõe `data/hotel.json`. Toda alteração vai para a auditoria.
- **Sem diária.** O quarto aparece como "preço sob consulta"; o assistente não gera link de pagamento e chama a equipe.
- **Testes.** Os testes automatizados usam o catálogo fictício `test/fixtures/hotel-teste.json` (`HOTEL_FILE` no `npm test`), nunca o do hotel.
