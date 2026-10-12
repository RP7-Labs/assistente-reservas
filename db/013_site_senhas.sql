-- Visitas do site por origem e a mesma senha em várias fechaduras (quarto + entrada do hotel).
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
create table if not exists reservas.visitas (
  id bigserial primary key,
  hotel_id text not null default 'principal' references reservas.hoteis(id),
  visitante text not null,                -- id aleatório do navegador (sem dado pessoal)
  pagina text,
  utm_source text, utm_medium text, utm_campaign text,
  referrer text,
  criado_em timestamptz not null default now()
);
create index if not exists visitas_hotel_data on reservas.visitas (hotel_id, criado_em);
alter table reservas.visitas enable row level security;

-- Senhas criadas nas fechaduras de uso comum (entrada): [{ lock_id, unidade, senha_id }]
alter table reservas.checkins add column if not exists senhas_extra jsonb not null default '[]';

grant all on reservas.visitas to service_role;
grant all on all sequences in schema reservas to service_role;
revoke all on reservas.visitas from anon, authenticated;
notify pgrst, 'reload schema';
