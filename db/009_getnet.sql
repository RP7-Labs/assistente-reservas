-- Pagamento real pela Getnet: guarda o provedor e o id do pagamento na Getnet.
-- Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
alter table reservas.pagamentos add column if not exists provedor text;          -- simulado | getnet
alter table reservas.pagamentos add column if not exists gateway_id text;        -- payment_id da Getnet
alter table reservas.pagamentos add column if not exists pix_copia_cola text;
alter table reservas.pagamentos add column if not exists pix_expira_em timestamptz;
alter table reservas.pagamentos add column if not exists gateway_status text;    -- último status recebido da Getnet
alter table reservas.pagamentos add column if not exists tentativas_pix int not null default 0;
