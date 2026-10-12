-- Só o servidor (service_role) acessa o schema reservas; o navegador (anon) nunca.
-- Corrige as tabelas criadas em 010 e 011 sem permissão para o servidor. Pode rodar mais de uma vez.
grant all on all tables in schema reservas to service_role;
grant all on all sequences in schema reservas to service_role;
revoke all on all tables in schema reservas from anon, authenticated;
revoke all on all sequences in schema reservas from anon, authenticated;
notify pgrst, 'reload schema';
