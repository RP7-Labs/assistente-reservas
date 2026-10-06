-- Checkout de pagamento (simulado por enquanto) e e-mails enviados.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
create table if not exists reservas.pagamentos (
  lead_id text primary key references reservas.leads(id),
  nome text,
  email text,
  telefone text,
  metodo text,                          -- cartao | pix
  status text not null default 'pendente', -- pendente | pre_autorizado | capturado | liberado | pago | recusado
  valor numeric(10,2),
  cartao_final text,                    -- só os 4 últimos dígitos; o número nunca é gravado
  cartao_bandeira text,
  autorizacao text,
  pix_txid text,
  codigo_reserva text,
  iniciado_em timestamptz not null default now(),
  pago_em timestamptz,
  lembrete_em timestamptz,
  atualizado_em timestamptz not null default now()
);
create index if not exists pagamentos_lembrete on reservas.pagamentos (status, iniciado_em) where lembrete_em is null;

create table if not exists reservas.emails (
  id bigserial primary key,
  para text not null,
  assunto text not null,
  corpo text not null,
  tipo text,                            -- lembrete_pagamento | confirmacao
  lead_id text,
  provedor text not null,               -- resend | simulado
  erro text,
  criado_em timestamptz not null default now()
);

alter table reservas.pagamentos enable row level security;
alter table reservas.emails enable row level security;
grant all on reservas.pagamentos, reservas.emails to service_role;
grant all on all sequences in schema reservas to service_role;
notify pgrst, 'reload schema';
