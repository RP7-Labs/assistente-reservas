-- Rodar no SQL Editor do Supabase depois do schema.sql. Pode rodar mais de uma vez.

-- Atendimentos que pediram um humano
alter table reservas.conversas add column if not exists precisa_atendente boolean not null default false;
alter table reservas.conversas add column if not exists motivo_atendente text;

-- Reservas (locações) registradas no back-office
alter table reservas.reservas add column if not exists quarto_id text;
alter table reservas.reservas add column if not exists checkin date;
alter table reservas.reservas add column if not exists checkout date;
alter table reservas.reservas add column if not exists hospede text;
alter table reservas.reservas add column if not exists atualizado_em timestamptz not null default now();

create index if not exists reservas_periodo on reservas.reservas (checkin, checkout);
create index if not exists leads_criado on reservas.leads (criado_em desc);
create index if not exists conversas_atualizado on reservas.conversas (atualizado_em desc);

grant all on all tables in schema reservas to service_role;
grant all on all sequences in schema reservas to service_role;
notify pgrst, 'reload schema';
