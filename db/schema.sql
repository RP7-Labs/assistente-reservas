-- Rodar no SQL Editor do Supabase.
-- Tudo fica no schema "reservas", então pode conviver com outro projeto no mesmo banco.
create schema if not exists reservas;

create table reservas.leads (
  id text primary key,
  criado_em timestamptz not null default now(),
  canal text not null,              -- web | whatsapp
  conversa_id text not null,
  quarto_id text not null,
  checkin date not null,
  checkout date not null,
  adultos int not null,
  criancas int not null default 0,
  noites int not null
);

create table reservas.cliques (
  id bigserial primary key,
  lead_id text not null references reservas.leads(id),
  em timestamptz not null default now()
);

create table reservas.conversas (
  id text primary key,              -- "wa:<telefone>" ou id do navegador
  canal text not null,
  mensagens jsonb not null default '[]',
  atualizado_em timestamptz not null default now()
);

-- Reservas confirmadas (importadas do relatório da Gasystem) para fechar a atribuição
create table reservas.reservas (
  codigo_motor text primary key,
  lead_id text references reservas.leads(id),
  valor numeric(10,2),
  status text,                      -- confirmada | cancelada | no_show | concluida
  criado_em timestamptz not null default now()
);

-- Só o backend (service role) acessa; nada exposto à chave pública
alter table reservas.leads enable row level security;
alter table reservas.cliques enable row level security;
alter table reservas.conversas enable row level security;
alter table reservas.reservas enable row level security;

grant usage on schema reservas to service_role;
grant all on all tables in schema reservas to service_role;
grant all on all sequences in schema reservas to service_role;
