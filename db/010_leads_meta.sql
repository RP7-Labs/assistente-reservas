-- Leads dos formulários de anúncio da Meta (Lead Ads), chamados no WhatsApp pelo assistente.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
create table if not exists reservas.leads_meta (
  id text primary key,                    -- leadgen_id da Meta
  recebido_em timestamptz not null default now(),
  criado_meta timestamptz,
  nome text, telefone text, email text,
  respostas jsonb,                        -- perguntas do formulário e respostas
  form_id text, ad_id text, ad_nome text, campanha text, conjunto text, plataforma text,
  conversa_id text,                       -- wa:<telefone>
  status text not null default 'novo',    -- novo | contatado | sem_telefone | sem_modelo | falha_envio
  tentativas int not null default 0,
  contatado_em timestamptz,
  respondeu_em timestamptz,
  erro text,
  atualizado_em timestamptz not null default now()
);
create index if not exists leads_meta_conversa on reservas.leads_meta (conversa_id);
alter table reservas.leads_meta enable row level security;

-- Id do lead na origem da conversa: a reserva paga volta para a Meta como conversão do lead
alter table reservas.origens add column if not exists meta_lead_id text;
grant all on reservas.leads_meta to service_role;
notify pgrst, 'reload schema';
