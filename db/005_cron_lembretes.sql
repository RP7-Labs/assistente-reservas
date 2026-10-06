-- Agenda os lembretes de pagamento por e-mail: a cada minuto, o Supabase chama a API.
-- A Vercel Hobby só permite cron diário, por isso o agendador fica no banco (pg_cron + pg_net, grátis).
--
-- Antes de rodar:
-- 1. Em Database > Extensions, ative "pg_cron" e "pg_net".
-- 2. Troque SEU_CRON_SECRET pelo mesmo valor da variável CRON_SECRET na Vercel.
--    (Digite direto aqui no SQL Editor; não mande o valor por chat.)
-- Pode rodar de novo para trocar o segredo ou a URL.

select cron.unschedule('lembretes-pagamento') where exists (select 1 from cron.job where jobname = 'lembretes-pagamento');

select cron.schedule(
  'lembretes-pagamento',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://reservas-rp7.vercel.app/api/tarefas/lembretes',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer SEU_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Para conferir as execuções:
-- select * from cron.job_run_details order by start_time desc limit 10;
