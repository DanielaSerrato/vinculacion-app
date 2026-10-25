-- Ejecutar en el SQL Editor de Supabase antes de publicar esta versión.
alter table public.conductores
  add column if not exists cedula_pdf text,
  add column if not exists pase_pdf text;
