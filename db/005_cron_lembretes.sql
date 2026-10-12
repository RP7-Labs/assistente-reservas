-- Agenda os lembretes de pagamento por e-mail: a cada minuto, o Supabase chama a API.
-- A Vercel Hobby só permite cron diário, por isso o agendador fica no banco (pg_cron + pg_net, grátis).
-- O segredo fica no Vault do Supabase (nome 'cron_secret'), nunca neste arquivo. Enquanto ele não existir, o job não chama nada.
--
-- Depois de rodar este arquivo:
-- 1. Invente um valor longo e aleatório e coloque na Vercel como CRON_SECRET (depois faça Redeploy).
-- 2. No SQL Editor do Supabase, rode com o MESMO valor (digite direto lá; não mande por chat):
--      select vault.create_secret('VALOR', 'cron_secret');
--    Para trocar depois:
--      select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), 'NOVO_VALOR');
-- Pode rodar de novo para trocar a URL.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('lembretes-pagamento') where exists (select 1 from cron.job where jobname = 'lembretes-pagamento');

select cron.schedule(
  'lembretes-pagamento',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://reservas-rp7.vercel.app/api/tarefas/lembretes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.decrypted_secret),
    body := '{}'::jsonb
  )
  from vault.decrypted_secrets s
  where s.name = 'cron_secret';
  $$
);

-- Para conferir as execuções:
-- select * from cron.job_run_details order by start_time desc limit 10;
-- select status_code, content from net._http_response order by created desc limit 5;
