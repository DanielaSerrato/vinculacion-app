-- Una misma persona solo debe tener una relación de cada rol por vehículo.
-- Es el respaldo de idempotencia del formulario y de la cola Systram.
create unique index if not exists persona_vehiculo_persona_vehiculo_rol_key
  on public.persona_vehiculo (persona_id, vehiculo_id, rol);

