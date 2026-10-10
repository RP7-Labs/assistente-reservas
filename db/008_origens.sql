-- Origem de cada conversa (campanha de tráfego pago, clique do anúncio) e conversões enviadas.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
create table if not exists reservas.origens (
  conversa_id text primary key,
  canal text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  gclid text, gbraid text, wbraid text,   -- clique do Google Ads
  fbclid text, fbc text, fbp text,        -- clique e navegador da Meta (Facebook/Instagram)
  ctwa_clid text, ad_id text,             -- anúncio que abre conversa no WhatsApp
  referrer text, landing text,
  ip text, user_agent text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists reservas.conversoes (
  id bigserial primary key,
  plataforma text not null,               -- meta | google
  evento text not null,                   -- Lead | Purchase
  event_id text not null,
  lead_id text,
  valor numeric(10,2),
  ok boolean not null,
  resposta text,
  criado_em timestamptz not null default now(),
  unique (plataforma, evento, event_id)
);

alter table reservas.origens enable row level security;
alter table reservas.conversoes enable row level security;
grant all on reservas.origens, reservas.conversoes to service_role;
grant all on all sequences in schema reservas to service_role;
notify pgrst, 'reload schema';
