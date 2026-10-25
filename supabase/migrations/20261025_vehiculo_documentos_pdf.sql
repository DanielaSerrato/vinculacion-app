-- Conserva la tarjeta de propiedad como un PDF de dos páginas.
alter table public.vehiculos
  add column if not exists tarjeta_pdf text;
