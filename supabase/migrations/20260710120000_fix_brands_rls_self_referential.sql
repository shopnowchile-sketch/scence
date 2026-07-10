-- Fix RLS crítico en public.brands — las 4 policies anteriores comparaban
-- organization_id contra sí misma vía un subquery correlacionado a `profiles`
-- (que además no tiene columna organization_id), quedando siempre verdadero
-- para cualquier usuario autenticado con fila en `profiles` (o sea, todos:
-- admin, marca e influencer, porque handle_new_user() crea esa fila en cada
-- signup). Efecto real: cualquier usuario logueado podía leer/crear/editar/
-- borrar CUALQUIER marca vía la REST API de Supabase directa (JWT propio,
-- sin pasar por la app). Documentado primero en
-- 20260701000001_baseline_brands_table.sql (solo como advertencia, no lo
-- corregía). Ver auditoría 2026-07-10.
--
-- Toda la app (portal admin y portal marca) escribe brands exclusivamente
-- vía createAdminClient() (service_role), que bypassa RLS — confirmado
-- revisando los 26 archivos bajo src/app/api/brand*/brands* antes de este
-- cambio. Por eso el modelo más seguro es: SELECT de su propia fila para
-- marca, CERO acceso directo para influencer, y CERO INSERT/UPDATE/DELETE
-- para cualquier rol autenticado (incluido admin) — todas las escrituras
-- reales siguen pasando por el backend con service_role, sin cambio de
-- comportamiento para ningún portal.
--
-- NO se agregan policies de INSERT/UPDATE/DELETE a propósito: con RLS
-- activo (ya lo estaba) y sin policy para esos comandos, quedan denegados
-- por defecto para el rol `authenticated`. `service_role` no está sujeto a
-- RLS y sigue operando sin restricción.

-- 1) Eliminar únicamente las 4 policies defectuosas
drop policy if exists "brands_select_own_org" on public.brands;
drop policy if exists "brands_insert_own_org" on public.brands;
drop policy if exists "brands_update_own_org" on public.brands;
drop policy if exists "brands_delete_own_org" on public.brands;

-- 2) Única policy nueva: SELECT de la propia fila, nada más
create policy "brands_select_owner_only"
on public.brands
for select
to authenticated
using (user_id = auth.uid());

-- Rollback (NO usar las policies autorreferenciales viejas — reabren el
-- hueco). Si hace falta revertir, dejar esta policy y volver a evaluar en
-- vez de restaurar el estado anterior:
--   drop policy if exists "brands_select_owner_only" on public.brands;
-- (sin volver a crear las 4 policies originales bajo ninguna circunstancia)
