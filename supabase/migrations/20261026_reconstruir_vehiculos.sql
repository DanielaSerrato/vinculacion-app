-- Reconstrucción de vehículos después de la migración accidental de la tabla.
-- Ejecutar en Supabase SQL Editor.
create table if not exists public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  placa text unique,
  tipo text,
  satelital boolean,
  satelital_proveedor text,
  satelital_usuario text,
  satelital_password text,
  created_at timestamptz not null default now()
);

-- Conserva los UUID que aún existen en persona_vehiculo/documentos.
insert into public.vehiculos (id, placa)
values
 ('64e61125-60f6-462e-869a-60baf0785bf8','LWL735'),
 ('fdf70b8e-be76-4280-9cf2-9550999e5e57','TFP118'),
 ('d162c90a-9295-4b7c-a1fe-aeebf5ea59ec','SBN866'),
 ('78f1bb1f-a4a3-468e-bfeb-d1c941392e45','JRY682'),
 ('081210ce-f767-412d-ab80-a5b92bb9064e','USB249')
on conflict (id) do update set placa = excluded.placa;

insert into public.vehiculos (id)
select distinct vehiculo_id from public.persona_vehiculo
where vehiculo_id is not null
  and not exists (select 1 from public.vehiculos v where v.id = persona_vehiculo.vehiculo_id);

alter table public.persona_vehiculo
  drop constraint if exists persona_vehiculo_vehiculo_id_fkey;
alter table public.persona_vehiculo
  add constraint persona_vehiculo_vehiculo_id_fkey
  foreign key (vehiculo_id) references public.vehiculos(id);

alter table public.documentos
  drop constraint if exists documentos_vehiculo_id_fkey;
alter table public.documentos
  add constraint documentos_vehiculo_id_fkey
  foreign key (vehiculo_id) references public.vehiculos(id);
