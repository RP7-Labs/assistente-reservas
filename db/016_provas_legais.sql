-- Provas legais: cada aceite (termos da reserva, ficha de hóspedes, contrato de temporada, pedidos do titular)
-- fica gravado com o texto exato que a pessoa viu, IP, navegador e data. Os registros não podem ser
-- alterados nem apagados, e cada um carrega o hash do anterior (corrente): mexer em um quebra a corrente.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez. Não apaga nada.

-- Textos legais publicados (política de privacidade, termos, contratos), guardados uma vez por versão
create table if not exists reservas.textos_legais (
  hash text primary key,                  -- sha256 do texto
  tipo text not null,
  texto text not null,
  criado_em timestamptz not null default now()
);

create table if not exists reservas.provas (
  id bigserial primary key,
  hotel_id text not null default 'principal' references reservas.hoteis(id),
  tipo text not null,                     -- aceite_reserva | ficha_hospedes | contrato_temporada | direito_titular | ...
  referencia text,                        -- código da reserva, id do pedido ou e-mail do titular
  titular jsonb,                          -- { nome, email, documento }
  texto_hash text references reservas.textos_legais(hash),
  dados jsonb,
  ip text,
  agente text,
  criado_em timestamptz not null default now(),
  hash_anterior text,
  hash text
);
create index if not exists provas_hotel_ref on reservas.provas (hotel_id, referencia);
create index if not exists provas_hotel_data on reservas.provas (hotel_id, criado_em desc);

-- Conteúdo que entra no hash de cada prova
create or replace function reservas.conteudo_prova(p reservas.provas) returns text
language sql stable set search_path = '' as $$
  select coalesce(p.hash_anterior, '') || '|' || jsonb_build_object(
    'hotel_id', p.hotel_id, 'tipo', p.tipo, 'referencia', p.referencia, 'titular', p.titular,
    'texto_hash', p.texto_hash, 'dados', p.dados, 'ip', p.ip, 'agente', p.agente,
    'criado_em', to_char(p.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text
$$;

create or replace function reservas.encadear_prova() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Uma prova por vez por hotel, para a corrente não bifurcar
  perform pg_advisory_xact_lock(hashtext('provas:' || new.hotel_id));
  new.criado_em := coalesce(new.criado_em, now());
  select p.hash into new.hash_anterior from reservas.provas p where p.hotel_id = new.hotel_id order by p.id desc limit 1;
  new.hash := encode(sha256(convert_to(reservas.conteudo_prova(new), 'UTF8')), 'hex');
  return new;
end $$;

create or replace function reservas.provas_imutaveis() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Provas legais não podem ser alteradas nem apagadas';
end $$;

create or replace trigger provas_encadear before insert on reservas.provas for each row execute function reservas.encadear_prova();
create or replace trigger provas_imutaveis before update or delete on reservas.provas for each row execute function reservas.provas_imutaveis();
create or replace trigger textos_imutaveis before update or delete on reservas.textos_legais for each row execute function reservas.provas_imutaveis();

-- Confere a corrente de um hotel: devolve a primeira prova adulterada (ou nada, se estiver íntegra)
create or replace function reservas.verificar_provas(h text)
returns table (id bigint, problema text)
language sql stable set search_path = '' as $$
  with c as (
    select p as linha, p.id, p.hash, p.hash_anterior, lag(p.hash) over (order by p.id) as anterior_real
    from reservas.provas p where p.hotel_id = h
  )
  select c.id, case when c.hash_anterior is distinct from c.anterior_real then 'corrente quebrada' else 'conteúdo alterado' end
  from c
  where c.hash_anterior is distinct from c.anterior_real
     or c.hash is distinct from encode(sha256(convert_to(reservas.conteudo_prova(c.linha), 'UTF8')), 'hex')
  order by c.id limit 1
$$;

-- Consentimento para anúncios (Meta/Google) dado na página de pagamento
alter table reservas.pagamentos add column if not exists consente_anuncios boolean;
alter table reservas.pagamentos add column if not exists termos_versao text;   -- versão dos termos aceitos (ver provas)

alter table reservas.textos_legais enable row level security;
alter table reservas.provas enable row level security;
grant select, insert on reservas.textos_legais, reservas.provas to service_role;
grant usage on sequence reservas.provas_id_seq to service_role;
grant execute on function reservas.verificar_provas(text) to service_role;
revoke all on reservas.textos_legais, reservas.provas from anon, authenticated;
revoke all on function reservas.verificar_provas(text) from anon, authenticated, public;
