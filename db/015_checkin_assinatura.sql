-- Pré-check-in: envio agendado da senha, avisos (e-mail/WhatsApp) e assinatura eletrônica do titular.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez. Não apaga nada.

-- Quando a senha deve sair (hotel configurou "X horas antes do check-in"); senha_status = 'agendada' até lá
alter table reservas.checkins add column if not exists senha_envio_em timestamptz;
-- Como foi o aviso da senha: { em, email, whatsapp }
alter table reservas.checkins add column if not exists senha_aviso jsonb;
-- Assinatura eletrônica simples (Lei 14.063/2020): { imagem (PNG base64), em, hash sha-256 da imagem + ficha + data, ip, agente }
alter table reservas.checkins add column if not exists assinatura jsonb;

create index if not exists checkins_senha_agendada on reservas.checkins (senha_envio_em) where senha_status = 'agendada';
notify pgrst, 'reload schema';
