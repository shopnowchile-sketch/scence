-- PROPUESTA — NO APLICADA. No está en supabase/migrations a propósito.
-- Hallazgo: `authenticated` tiene SELECT a nivel de tabla sobre public.organizations
-- (incluye google_access_token, google_refresh_token, ids de Stripe y settings) y la
-- política `organizations_select_member` deja a CUALQUIER miembro activo leer la fila de
-- su organización. Con su propio JWT (PostgREST) puede leer esas columnas sin pasar por
-- las rutas. Escritura: bloqueada (RLS sin políticas de escritura).
-- Efecto de esta propuesta: el cliente solo lee columnas no sensibles; el servidor
-- (service_role) no se ve afectado. Revisar antes: cualquier consulta de navegador con
-- select('*') sobre organizations dejaría de funcionar (hoy solo AppSidebar, que pide `name`).
-- Reversión: grant select on public.organizations to authenticated;  (anon no se reabre).
begin;
revoke select on public.organizations from anon, authenticated;
grant select (id, slug, name, type, logo_url, website, industry, country, address, tax_id,
              billing_email, currency, is_active, created_at, updated_at,
              subscription_status, subscription_plan, subscription_period_end)
  on public.organizations to authenticated;
-- Defensa en profundidad: ningún cliente escribe en las columnas de tokens.
revoke insert, update on public.organizations from anon, authenticated;
commit;
-- Verificación previa a producción (solo lectura, sin valores):
--   select count(*) filter (where google_refresh_token is not null) as con_refresh,
--          count(*) filter (where google_access_token  is not null) as con_access
--   from public.organizations;
-- Si hay tokens con valor: rotar/revocar en Google antes de cualquier otra cosa.
