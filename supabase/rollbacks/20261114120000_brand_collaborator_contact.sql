-- Revertir primero el código que usa estas columnas. Exportar contactos antes de eliminarlas.
alter table public.brand_collaborators
  drop column if exists contact_name,
  drop column if exists contact_email,
  drop column if exists contact_phone;
