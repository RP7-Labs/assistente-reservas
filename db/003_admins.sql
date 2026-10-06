-- Usuários do back-office. Rodar no SQL Editor do Supabase. Pode rodar mais de uma vez.
create table if not exists reservas.admins (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,           -- sempre em minúsculas
  senha_hash text not null,             -- scrypt
  status text not null default 'pendente', -- pendente | aprovado | recusado
  aprovado_por uuid references reservas.admins(id),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now()
);

alter table reservas.admins enable row level security;
grant all on reservas.admins to service_role;
notify pgrst, 'reload schema';
