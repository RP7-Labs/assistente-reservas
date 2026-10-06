-- Canais externos sincronizados por iCal (Airbnb, Booking.com...) e as datas que eles bloqueiam.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
create table if not exists reservas.canais (
  id text primary key,
  nome text not null,                   -- ex.: "Airbnb · Suíte 1"
  quarto_id text not null,              -- tipo de quarto do hotel.json; cada anúncio ocupa uma unidade
  url_importar text,                    -- link .ics do anúncio (Airbnb: Calendário > Sincronizar > Exportar)
  token_exportar text not null unique,  -- segredo do link que o anúncio importa
  ultimo_sync timestamptz,
  erro text,
  criado_em timestamptz not null default now()
);

create table if not exists reservas.bloqueios (
  id bigserial primary key,
  canal_id text not null references reservas.canais(id) on delete cascade,
  quarto_id text not null,
  uid text,
  checkin date not null,
  checkout date not null,
  resumo text
);
create index if not exists bloqueios_periodo on reservas.bloqueios (quarto_id, checkin, checkout);

alter table reservas.canais enable row level security;
alter table reservas.bloqueios enable row level security;
grant all on reservas.canais, reservas.bloqueios to service_role;
grant all on all sequences in schema reservas to service_role;
notify pgrst, 'reload schema';
