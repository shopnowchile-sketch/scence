-- PROPUESTA (NO aplicada) — 2026-10-22
-- RLS influencers: cerrar `influencers_org_read`.
-- Hallazgo (rama de pruebas dexpvoubiklgotuukrml, solo lectura): política única, cmd=ALL, roles={public},
--   USING (organization_id IN (membresías activas del usuario) OR organization_id IS NULL)
-- y anon/authenticated tienen SELECT/INSERT/UPDATE/DELETE/TRUNCATE sobre la tabla. Consecuencia: cualquier
-- fila con organization_id NULL era legible Y modificable/borrable con la clave pública (incluso sin sesión),
-- y cualquier miembro de una organización podía escribir fichas de ella por PostgREST.
-- Datos: en esa rama hay 152 fichas y 0 con organization_id NULL (producción: por medir, ver consulta al final).
-- Esta propuesta NO borra ni reasigna datos. Las rutas del producto usan service-role y no dependen de la política.
-- Con la política nueva las fichas NULL dejan de ser accesibles por PostgREST (solo service-role).
begin;
drop policy if exists "influencers_org_read" on public.influencers;

create policy influencers_member_read on public.influencers
  for select to authenticated
  using (organization_id is not null and organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true));

-- Paridad con lo existente para miembros (sin ampliar): se recomienda eliminar estas escrituras directas en una
-- etapa posterior, porque todas las escrituras del producto pasan por rutas con service-role.
create policy influencers_member_write on public.influencers
  for all to authenticated
  using (organization_id is not null and organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true))
  with check (organization_id is not null and organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true));
commit;

-- Propuesta aparte (cambio de privilegios; requiere aprobación específica). NO usar `revoke all ... from anon`:
-- en producción hay 11 políticas de otras tablas (locations, barters, subscription_payments, campaign_influencers,
-- etc.) con subconsulta a influencers y `anon` tiene SELECT en esas tablas; sin SELECT sobre influencers esas
-- consultas darían «permission denied» en lugar de vacío (probado en local). Variante recomendada:
--   revoke insert, update, delete, truncate, trigger, references on public.influencers from anon;      -- anon conserva SELECT (la RLS le da 0 filas)
--   revoke truncate, trigger, references on public.influencers from authenticated;
-- Reversión de la política: recrear influencers_org_read tal como está en 20260527000001_auth_hooks.sql.
--
-- Medición de fichas sin organización (solo lectura, para ejecutar con autorización):
--   select count(*) total, count(*) filter (where organization_id is null) sin_org from public.influencers;
