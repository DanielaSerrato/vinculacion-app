-- Archivado reversible de tablas históricas.
-- Ejecutar solo después de confirmar que ningún formulario antiguo sigue activo.
-- No elimina registros: conserva los datos y sus restricciones.

alter table if exists public.vinculaciones rename to vinculaciones_historico_20261026;
alter table if exists public.conductores rename to conductores_historico_20261026;
alter table if exists public.propietarios rename to propietarios_historico_20261026;
alter table if exists public.vehiculos rename to vehiculos_historico_20261026;

comment on table public.vinculaciones_historico_20261026 is 'Tabla histórica archivada el 2026-10-26; conservar hasta validar la migración completa.';
comment on table public.conductores_historico_20261026 is 'Tabla histórica archivada el 2026-10-26; conservar hasta validar la migración completa.';
comment on table public.propietarios_historico_20261026 is 'Tabla histórica archivada el 2026-10-26; conservar hasta validar la migración completa.';
comment on table public.vehiculos_historico_20261026 is 'Tabla histórica archivada el 2026-10-26; conservar hasta validar la migración completa.';
