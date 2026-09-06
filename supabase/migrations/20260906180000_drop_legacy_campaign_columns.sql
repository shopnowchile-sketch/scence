-- Limpieza de deuda legacy en public.campaigns (auditoría 2026-09-06).
--
-- Elimina 5 columnas confirmadas sin uso funcional en código NI en objetos de
-- Postgres (vistas, RLS, funciones/RPC, triggers, constraints — verificado
-- contra pg_views/pg_matviews/pg_proc/pg_policies/pg_trigger/pg_constraint
-- antes de esta migración) Y sin datos históricos irrecuperables:
--
-- 1. content_guidelines — reemplazado por description desde el backfill del
--    2026-09-04 (commit a2bb6c4). Las 10/17 campañas que tenían contenido acá
--    ya lo tienen fusionado en description (verificado con ILIKE substring
--    antes de esta migración). Código de aplicación limpiado en el mismo PR
--    que esta migración (creación admin/marca, PATCH marca, duplicate,
--    ai-build, SELECTs de influencer, Zod/types/forms).
-- 2. address — columna física reemplazada por metadata.address desde un fix
--    documentado en el código (ver comentarios en
--    src/app/api/campaigns/[id]/route.ts y src/app/api/brand/campaigns/[id]/route.ts:
--    "reparaba borradores antiguos que gatillaban un error del schema cache
--    de Supabase"). 0/17 campañas tienen dato en esta columna; 6/17 lo tienen
--    en metadata->>'address'. Ningún código lee ni escribe esta columna
--    directamente.
-- 3. do_follow_links — 0/17 campañas con datos, único uso en código era
--    copiarla en /api/campaigns/[id]/duplicate (ya limpiado).
-- 4. internal_notes — 0/17 campañas con datos, único uso en código era
--   copiarla en duplicate (ya limpiado). NO confundir con bookings.internal_notes,
--   que es una columna distinta, activa, y no se toca en esta migración.
-- 5. sorteo_winner — 0/17 campañas con datos, cero referencias en código.
--
-- NO se eliminan en esta migración (quedan reportadas, no borradas, por tener
-- datos históricos reales sin equivalente en otro campo):
-- - mention_handles: 14/17 campañas con datos; 5 de esas campañas tienen
--   mention_handles poblado con social_tags vacío (divergencia real, no es
--   redundante en esos casos). Código ya no la escribe ni la lee (limpiado en
--   el mismo PR), pero la columna se conserva hasta decidir un backfill
--   mention_handles → social_tags para esas 5 campañas.
-- - raffle_date, raffle_rules, raffle_status, prize: 1-2 filas con datos
--   históricos de una campaña de sorteo anterior al rediseño de
--   campaign_benefits/activation_rule='raffle'. Cero código las referencia,
--   pero no hay reporte ni vista que exponga ese historial en otro lugar.
--
-- Esta migración se aplica DESPUÉS de confirmar que el código que ya no
-- referencia estas columnas está desplegado y sano en producción (orden
-- elegido por seguridad: código primero, columna después — evita una ventana
-- donde código viejo en producción intente leer/escribir una columna ya
-- eliminada).

ALTER TABLE public.campaigns DROP COLUMN IF EXISTS content_guidelines;
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS address;
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS do_follow_links;
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS internal_notes;
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS sorteo_winner;
