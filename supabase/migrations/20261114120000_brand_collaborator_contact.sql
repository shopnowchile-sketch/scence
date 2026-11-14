alter table public.brand_collaborators
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

grant update (contact_name, contact_email, contact_phone)
  on table public.brand_collaborators to service_role;
