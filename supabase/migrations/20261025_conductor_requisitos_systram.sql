-- Campos necesarios para completar las pestañas de conductor en Systram.
alter table public.conductores
  add column if not exists telefono_alterno text,
  add column if not exists emergencia_nombre text,
  add column if not exists emergencia_parentesco text,
  add column if not exists emergencia_telefono text,
  add column if not exists licencia_categoria text,
  add column if not exists licencia_vencimiento date,
  add column if not exists antecedentes_procuraduria text,
  add column if not exists antecedentes_policia text,
  add column if not exists runt text,
  add column if not exists comparendos text,
  add column if not exists lista_clinton text,
  add column if not exists antecedentes_fiscales text,
  add column if not exists estudio_seguridad text;
