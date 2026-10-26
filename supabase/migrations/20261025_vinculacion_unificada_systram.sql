-- Datos y trazabilidad requeridos por el flujo unificado de vinculacion.
-- Ejecutar una vez en Supabase SQL Editor antes de publicar esta version.
alter table public.personas
  add column if not exists telefono_alterno text,
  add column if not exists emergencia_nombre text,
  add column if not exists emergencia_parentesco text,
  add column if not exists emergencia_telefono text;

alter table public.persona_vehiculo
  add column if not exists licencia_categoria text,
  add column if not exists licencia_vencimiento date,
  add column if not exists systram_estado text not null default 'pendiente',
  add column if not exists systram_etapa text,
  add column if not exists systram_id text,
  add column if not exists systram_error text,
  add column if not exists systram_ultimo_intento_en timestamptz,
  add column if not exists systram_verificado_en timestamptz;

create index if not exists persona_vehiculo_systram_pendiente_idx
  on public.persona_vehiculo (systram_estado, created_at desc);
