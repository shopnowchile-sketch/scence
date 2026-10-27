-- Recrea brand_locations desde el respaldo (RLS activo y sin políticas: solo service_role, como antes).
create table public.brand_locations as table ops.backup_brand_locations_20261028;
alter table public.brand_locations add primary key (id);
alter table public.brand_locations enable row level security;
