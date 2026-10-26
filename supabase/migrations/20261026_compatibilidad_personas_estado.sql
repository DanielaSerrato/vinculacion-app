-- Compatibilidad con triggers históricos que todavía leen OLD.estado.
alter table public.personas
  add column if not exists estado text not null default 'pendiente';
