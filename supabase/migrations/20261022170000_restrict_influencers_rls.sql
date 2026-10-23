-- PREPARADA, NO APLICADA (2026-10-22). Independiente de 20261022150000 y 20261022160000. Aprobación propia.
-- Cierra `influencers_org_read` (ALL, {public}, `... OR organization_id IS NULL`) y retira escrituras de `anon`.
-- NO toca datos, organization_id, membresías ni roles. Las rutas del producto usan service_role (no dependen de RLS).
--
-- Efecto sobre las políticas de otras tablas que consultan `influencers` (10 reales; `brand_influencers` solo coincide
-- por nombre y consulta `brands`): sus subconsultas se evalúan con la RLS de `influencers` del que consulta.
-- Por eso `anon` CONSERVA SELECT (provisional): sin él esas consultas fallarían con «permission denied» en vez de vacío.
-- Reversión: recrear influencers_org_read (20260527000001_auth_hooks.sql) y `grant` los privilegios retirados.

drop policy if exists "influencers_org_read" on public.influencers;
drop policy if exists influencers_member_read on public.influencers;
drop policy if exists influencers_member_write on public.influencers;

create policy influencers_member_read on public.influencers
  for select to authenticated
  using (organization_id is not null and organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true));

-- Paridad con lo existente para miembros (sin ampliar el ámbito). Recomendado retirar en una etapa posterior.
create policy influencers_member_write on public.influencers
  for all to authenticated
  using (organization_id is not null and organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true))
  with check (organization_id is not null and organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true));

revoke insert, update, delete, truncate, trigger, references on public.influencers from anon;
revoke truncate, trigger, references on public.influencers from authenticated;
