-- Esquema para quando o piloto sair do arquivo JSON (Postgres / Supabase)
create table leads (
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
create table cliques (
  id bigserial primary key,
  lead_id text not null references leads(id),
  em timestamptz not null default now()
);
-- Reservas confirmadas (importadas do motor/relatório da Gasystem) para fechar a atribuição
create table reservas (
  codigo_motor text primary key,
  lead_id text references leads(id),
  valor numeric(10,2),
  status text,                      -- confirmada | cancelada | no_show | concluida
  criado_em timestamptz not null default now()
);
