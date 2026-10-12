-- Vários hotéis (multi-tenant) e vários países.
-- Rodar no SQL Editor do Supabase logo depois de publicar esta versão. Pode rodar mais de uma vez.
-- Os dados que já existem ficam no hotel 'principal' (o hotel piloto).

create table if not exists reservas.hoteis (
  id text primary key,                         -- ex.: 'rezende-suites' (vai no domínio ou em ?hotel=)
  nome text not null,
  pais text not null default 'BR',             -- BR | AR | PY | US
  idioma text, moeda text, fuso text,          -- vazios = padrão do país
  dominios text[] not null default '{}',       -- domínios próprios do hotel
  config jsonb not null default '{}',          -- catálogo (quartos, políticas), cidade, integracoes {whatsapp_phone_number_id, meta_page_id}
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table reservas.hoteis enable row level security;
insert into reservas.hoteis (id, nome, pais) values ('principal', 'Hotel principal', 'BR') on conflict (id) do nothing;

-- hotel_id em todas as tabelas, com o hotel principal para o que já existe
do $$
declare t text;
begin
  foreach t in array array['leads','cliques','conversas','reservas','admins','pagamentos','emails','canais','bloqueios','unidades','checkins','origens','conversoes','leads_meta'] loop
    if to_regclass('reservas.' || t) is not null then
      execute format('alter table reservas.%I add column if not exists hotel_id text not null default %L references reservas.hoteis(id)', t, 'principal');
      execute format('create index if not exists %I on reservas.%I (hotel_id)', t || '_hotel_idx', t);
    end if;
  end loop;
end $$;

-- Chaves que podem se repetir entre hotéis passam a incluir o hotel
alter table reservas.conversas drop constraint if exists conversas_pkey, add primary key (hotel_id, id);
alter table reservas.reservas drop constraint if exists reservas_pkey, add primary key (hotel_id, codigo_motor);
alter table reservas.origens drop constraint if exists origens_pkey, add primary key (hotel_id, conversa_id);
alter table reservas.unidades drop constraint if exists unidades_pkey, add primary key (hotel_id, numero);
alter table reservas.checkins drop constraint if exists checkins_pkey, add primary key (hotel_id, codigo_reserva);
alter table reservas.conversoes drop constraint if exists conversoes_plataforma_evento_event_id_key;
alter table reservas.conversoes drop constraint if exists conversoes_unico;
alter table reservas.conversoes add constraint conversoes_unico unique (hotel_id, plataforma, evento, event_id);

grant all on reservas.hoteis to service_role;
notify pgrst, 'reload schema';
