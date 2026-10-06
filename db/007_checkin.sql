-- Check-in digital: unidades com fechadura, ficha dos hóspedes e senha por reserva.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
create table if not exists reservas.unidades (
  numero text primary key,              -- ex.: "101"
  quarto_id text not null,              -- tipo de quarto do hotel.json
  lock_id text,                         -- id da fechadura na TTLock (vazio = sem fechadura)
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists reservas.checkins (
  codigo_reserva text primary key,      -- reservas.codigo_motor
  token text not null unique,           -- segredo do link de pré-check-in
  status text not null default 'pendente', -- pendente | concluido
  hospedes jsonb,                       -- ficha de cada hóspede (titular primeiro)
  chegada_prevista text,
  concluido_em timestamptz,
  unidade text,
  senha text,
  senha_id text,                        -- keyboardPwdId na TTLock
  senha_inicio timestamptz,
  senha_fim timestamptz,
  senha_status text,                    -- ativa | simulada | revogada | erro | sem_unidade
  senha_erro text,
  fnrh_status text,                     -- simulado | registrado | erro | cancelado | noshow
  fnrh_erro text,
  fnrh_reserva_id text,                 -- reserva_id devolvido pela FNRH Digital
  fnrh_link text,                       -- link_precheckin do governo
  fnrh_entrada_em timestamptz,
  fnrh_saida_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table reservas.unidades enable row level security;
alter table reservas.checkins enable row level security;
grant all on reservas.unidades, reservas.checkins to service_role;
notify pgrst, 'reload schema';
