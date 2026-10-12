-- Resultados de marketing: gasto das campanhas, reservas do PMS/motor, importações, configurações e auditoria.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez. Não apaga nada.

-- Gasto e números das plataformas por dia (Google Ads, Meta Ads). Reimportar o mesmo dia atualiza, não duplica.
create table if not exists reservas.midia_diaria (
  hotel_id text not null default 'principal' references reservas.hoteis(id),
  plataforma text not null,               -- google | meta
  data date not null,
  campanha_id text not null,              -- id da campanha (ou o nome, se o relatório não trouxer o id)
  campanha text,
  grupo_id text not null default '',      -- grupo de anúncios / conjunto (vazio = campanha inteira)
  grupo text,
  anuncio_id text not null default '',
  anuncio text,
  impressoes bigint not null default 0,
  alcance bigint,
  cliques bigint not null default 0,
  custo numeric(12,2) not null default 0,
  conversoes_plataforma numeric(12,2),    -- o que a plataforma diz (nunca somar Google + Meta)
  valor_plataforma numeric(12,2),
  importacao_id bigint,
  atualizado_em timestamptz not null default now(),
  primary key (hotel_id, plataforma, data, campanha_id, grupo_id, anuncio_id)
);

-- Reservas vindas do PMS ou do motor (relatório importado). Sem nome nem documento do hóspede.
create table if not exists reservas.reservas_externas (
  hotel_id text not null default 'principal' references reservas.hoteis(id),
  fonte text not null,                    -- pms | motor
  codigo text not null,                   -- localizador da reserva na fonte
  data_reserva date,
  checkin date,
  checkout date,
  noites int,
  categoria text,
  valor_bruto numeric(12,2),
  desconto numeric(12,2),
  valor_liquido numeric(12,2),
  canal text,                             -- como veio no relatório (Booking.com, Site, Balcão...)
  campanha text,
  status text,                            -- confirmada | cancelada | no_show | concluida
  reembolso numeric(12,2),
  importacao_id bigint,
  atualizado_em timestamptz not null default now(),
  primary key (hotel_id, fonte, codigo)
);
create index if not exists reservas_externas_data on reservas.reservas_externas (hotel_id, data_reserva);

-- Histórico de importações (arquivo, contagens, erros, quem importou)
create table if not exists reservas.importacoes (
  id bigserial primary key,
  hotel_id text not null default 'principal' references reservas.hoteis(id),
  tipo text not null,                     -- google | meta | pms
  arquivo text,
  linhas int, novas int, atualizadas int, ignoradas int,
  periodo_de date, periodo_ate date,
  erros jsonb,
  usuario text,
  criado_em timestamptz not null default now()
);

-- Configurações editáveis: metas, custos variáveis, orçamento de ferramentas
create table if not exists reservas.configuracoes (
  hotel_id text not null default 'principal' references reservas.hoteis(id),
  chave text not null,
  valor jsonb not null,
  atualizado_por text,
  atualizado_em timestamptz not null default now(),
  primary key (hotel_id, chave)
);

-- Auditoria: quem fez o quê (importações, mudanças de metas e custos)
create table if not exists reservas.auditoria (
  id bigserial primary key,
  hotel_id text not null default 'principal' references reservas.hoteis(id),
  usuario text,
  acao text not null,
  detalhe jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists auditoria_hotel_data on reservas.auditoria (hotel_id, criado_em desc);

alter table reservas.midia_diaria enable row level security;
alter table reservas.reservas_externas enable row level security;
alter table reservas.importacoes enable row level security;
alter table reservas.configuracoes enable row level security;
alter table reservas.auditoria enable row level security;
grant all on reservas.midia_diaria, reservas.reservas_externas, reservas.importacoes, reservas.configuracoes, reservas.auditoria to service_role;
grant all on all sequences in schema reservas to service_role;
revoke all on reservas.midia_diaria, reservas.reservas_externas, reservas.importacoes, reservas.configuracoes, reservas.auditoria from anon, authenticated;
notify pgrst, 'reload schema';
