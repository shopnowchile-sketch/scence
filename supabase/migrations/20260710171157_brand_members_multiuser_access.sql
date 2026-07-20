
-- 0) Soltar el CHECK viejo ANTES de remapear datos (el UPDATE a 'member'
--    viola el constraint anterior que solo permite owner/editor/viewer).
alter table public.brand_members drop constraint brand_members_role_check;

-- 1) Remap roles existentes 'editor' -> 'member' (excepto la fila de mateluna641
--    que se convierte en reparación puntual: brand_manager + vinculación).
update public.brand_members
set role = 'member'
where role = 'editor'
  and id <> '3e395b0f-7a63-4127-8b12-9917dba0f652';

-- Reparación mateluna641@gmail.com -> brand_manager de "Emprende y aprende"
-- (fila YA existente, invitada 2026-06-24, nunca vinculada). No se crea fila
-- nueva, no se crea marca ni organización nueva.
update public.brand_members
set role       = 'brand_manager',
    user_id    = '07f37bdb-93df-4e8c-9f83-999914a46983',
    joined_at  = now(),
    is_active  = true
where id = '3e395b0f-7a63-4127-8b12-9917dba0f652';

-- Backfill: alexrabi91@gmail.com (owner real vía brands.user_id) no tenía
-- fila propia en brand_members -> se agrega como 'owner' para que la lista
-- de Equipo sea consistente (idempotente).
insert into public.brand_members (brand_id, email, role, invited_by, joined_at, is_active)
values (
  '7e9fd33f-b3c1-420c-935e-3748a1f113e3',
  'alexrabi91@gmail.com',
  'owner',
  '2ec6bccb-f751-4d34-a992-2eb68ac112d7',
  now(),
  true
)
on conflict (brand_id, email) do nothing;

-- 2) Ampliar el CHECK de roles a los 4 roles mínimos del spec.
alter table public.brand_members add constraint brand_members_role_check
  check (role = any (array['owner', 'brand_manager', 'finance', 'member']));

-- 3) Función security definer con search_path fijo — única fuente de verdad
--    para "puede este usuario ver esta marca" (owner directo o miembro activo
--    en brand_members). SECURITY DEFINER evita la recursión de RLS al
--    consultar brand_members desde su propia policy.
create or replace function public.user_can_access_brand(target_brand_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.brands
    where id = target_brand_id and user_id = auth.uid()
  )
  or exists (
    select 1 from public.brand_members
    where brand_id = target_brand_id
      and user_id = auth.uid()
      and is_active = true
  );
$$;

revoke all on function public.user_can_access_brand(uuid) from public;
grant execute on function public.user_can_access_brand(uuid) to authenticated;

-- 4) Policy SELECT de brands: owner o miembro activo (reemplaza
--    brands_select_owner_only). Sin dependencia de organization_members.
drop policy if exists brands_select_owner_only on public.brands;
create policy brands_select_owner_or_member
  on public.brands
  for select
  to authenticated
  using (public.user_can_access_brand(id));

-- 5) Policy SELECT de brand_members: mismo criterio (owner o miembro activo
--    de ESA marca), reemplaza la policy anterior basada en
--    organization_members (org_members_read_brand_members).
drop policy if exists org_members_read_brand_members on public.brand_members;
create policy brand_access_read_members
  on public.brand_members
  for select
  to authenticated
  using (public.user_can_access_brand(brand_id));

-- brand_owner_insert_members y brand_owner_update_members quedan sin cambios
-- (ya son correctas: solo el owner de brands.user_id puede insertar/actualizar).
;
