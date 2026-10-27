-- PROPUESTA (NO aplicada, NO es migración) — 2026-10-22. Depende de 20261022170000_restrict_influencers_rls.sql.
-- Objetivo: que una influencer pueda leer SOLO su ficha por PostgREST/RLS, sin ser miembro de la organización comercial
-- y sin ver otras fichas. Auditoría: hoy el portal NO lo necesita (todas sus rutas /api/influencer/* y el layout leen
-- `influencers` con service_role filtrando por user_id = sesión). Solo lo necesitarían las 10 políticas «propias» de
-- otras tablas, que hoy devuelven 0 filas para una influencer no miembro (sus subconsultas pasan por la RLS de influencers).
create policy influencers_self_read on public.influencers
  for select to authenticated
  using (user_id = auth.uid());
-- Solo SELECT: sin política de escritura, la influencer no modifica su ficha por esta vía (las escrituras siguen en rutas service_role).
-- Límites: expone TODAS las columnas de su propia fila (organization_id, metadata, campos internos). Si eso no es aceptable,
-- alternativa B: función SECURITY DEFINER `public.my_influencer_id()` + reescribir las 10 políticas dependientes para usarla,
-- sin dar SELECT sobre `influencers`. Reversión: drop policy influencers_self_read on public.influencers;
