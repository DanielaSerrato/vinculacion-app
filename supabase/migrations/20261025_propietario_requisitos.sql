-- Expediente del propietario: identificación en PDF, fotografía y contactos.
alter table public.propietarios
  add column if not exists cedula_pdf text,
  add column if not exists foto_rostro text,
  add column if not exists telefono_alterno text,
  add column if not exists referencia_nombre text,
  add column if not exists referencia_telefono text,
  add column if not exists emergencia_nombre text,
  add column if not exists emergencia_parentesco text,
  add column if not exists emergencia_telefono text;
