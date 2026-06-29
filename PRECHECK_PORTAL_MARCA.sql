-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — PRE-CHECK PORTAL MARCA
-- Solo lectura. No modifica datos.
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- Revisar cada resultado antes de ejecutar MIGRATIONS_PORTAL_MARCA.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Estados actuales de campaign_influencers ───────────────────────────────
-- CRÍTICO: Revisar antes de ejecutar el mapeo de status → application_status.
-- Si ves valores inesperados, ajustar el mapeo en MIGRATIONS_PORTAL_MARCA.sql.

SELECT
  status::TEXT        AS status_actual,
  COUNT(*)            AS cantidad,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS porcentaje
FROM campaign_influencers
GROUP BY status::TEXT
ORDER BY cantidad DESC;

-- RESULTADO ESPERADO: valores como draft, active, completed, canceled, paused.
-- Si ves valores distintos, actualizar el CASE en la migración.
-- Si la tabla está vacía (0 filas), el mapeo no importa — se puede ejecutar libre.

-- ── 2. Total de registros en campaign_influencers ─────────────────────────────

SELECT COUNT(*) AS total_registros FROM campaign_influencers;

-- Si es 0: sin riesgo. Si tiene datos: revisar el mapeo con cuidado.

-- ── 3. Roles actuales de organization_members ─────────────────────────────────
-- Confirmar si ya existen usuarios brand_manager o influencer en el sistema.

SELECT
  role::TEXT          AS rol,
  COUNT(*)            AS cantidad,
  COUNT(CASE WHEN is_active THEN 1 END) AS activos
FROM organization_members
GROUP BY role::TEXT
ORDER BY cantidad DESC;

-- RESULTADO ESPERADO: mayoría agency_manager o super_admin.
-- Si hay brand_manager: ya existen usuarios de marca — brand_id = NULL por ahora (correcto).
-- Si no hay brand_manager: la columna brand_id se agrega limpia, sin impacto.

-- ── 4. Cantidad de marcas (brands) ───────────────────────────────────────────

SELECT
  COUNT(*)                                              AS total_marcas,
  COUNT(user_id)                                        AS marcas_con_user_id,
  COUNT(CASE WHEN user_id IS NULL THEN 1 END)           AS marcas_sin_user_id
FROM brands;

-- marcas_con_user_id > 0 → ya hay marcas con login.
-- Esas marcas necesitarán brand_id en organization_members para acceder al portal.

-- ── 5. Cantidad de influencers y uso de rate_cards ────────────────────────────

SELECT
  (SELECT COUNT(*) FROM influencers)               AS total_influencers,
  (SELECT COUNT(*) FROM influencers WHERE is_active) AS influencers_activos,
  (SELECT COUNT(*) FROM influencer_rate_cards)     AS total_rate_cards,
  (SELECT COUNT(DISTINCT influencer_id)
   FROM influencer_rate_cards)                     AS influencers_con_rate_card,
  (SELECT COUNT(*) FROM influencers) -
  (SELECT COUNT(DISTINCT influencer_id)
   FROM influencer_rate_cards)                     AS influencers_sin_rate_card;

-- ── 6. Detalle de rate_cards por tipo ─────────────────────────────────────────
-- Muestra qué tipos de deliverable tienen tarifas cargadas.

SELECT
  deliverable_type::TEXT                            AS tipo,
  COUNT(*)                                          AS cantidad,
  MIN(base_rate)                                    AS tarifa_minima,
  MAX(base_rate)                                    AS tarifa_maxima,
  ROUND(AVG(base_rate), 0)                          AS tarifa_promedio,
  currency::TEXT                                    AS moneda
FROM influencer_rate_cards
GROUP BY deliverable_type::TEXT, currency::TEXT
ORDER BY cantidad DESC;

-- ── 7. Análisis de conflicto: suggested_fee vs rate_cards ────────────────────
-- Muestra influencers que YA tienen rate_cards cargadas.
-- Estos son los casos donde suggested_fee podría generar ambigüedad.

SELECT
  i.id,
  i.display_name,
  COUNT(rc.id)                                      AS rate_cards_cargadas,
  MIN(rc.base_rate)                                 AS tarifa_min,
  MAX(rc.base_rate)                                 AS tarifa_max
FROM influencers i
JOIN influencer_rate_cards rc ON rc.influencer_id = i.id
WHERE i.is_active = TRUE
GROUP BY i.id, i.display_name
ORDER BY rate_cards_cargadas DESC
LIMIT 20;

-- Si rate_cards_cargadas > 0 para muchos influencers:
-- → suggested_fee es redundante. Usar MIN o AVG de rate_cards como fallback en código.
-- → No agregar la columna. Eliminar de MIGRATIONS_PORTAL_MARCA.sql.
--
-- Si influencer_rate_cards está vacía (0 filas):
-- → suggested_fee tiene sentido como campo simple de referencia rápida.
-- → Se puede agregar sin conflicto.

-- ── 8. Campañas activas actualmente ──────────────────────────────────────────
-- Verificar que las migraciones no afectan campañas en curso.

SELECT
  status::TEXT        AS estado,
  COUNT(*)            AS cantidad,
  COUNT(brand_id)     AS con_marca
FROM campaigns
GROUP BY status::TEXT
ORDER BY cantidad DESC;

-- ── 9. Resumen general de riesgo ─────────────────────────────────────────────

SELECT
  'campaign_influencers rows'   AS check_item,
  COUNT(*)::TEXT                AS valor,
  CASE WHEN COUNT(*) = 0
    THEN 'SIN RIESGO — tabla vacía'
    ELSE 'REVISAR mapeo de status antes de migrar'
  END                           AS evaluacion
FROM campaign_influencers

UNION ALL

SELECT
  'brand users (brand_manager)',
  COUNT(*)::TEXT,
  CASE WHEN COUNT(*) = 0
    THEN 'SIN RIESGO — no hay brand_managers aún'
    ELSE 'INFO — ' || COUNT(*) || ' brand_managers existentes, brand_id quedará NULL (correcto)'
  END
FROM organization_members
WHERE role::TEXT = 'brand_manager'

UNION ALL

SELECT
  'influencer_rate_cards usage',
  COUNT(*)::TEXT,
  CASE WHEN COUNT(*) = 0
    THEN 'suggested_fee es seguro de agregar — rate_cards vacía'
    ELSE 'EVALUAR — rate_cards tiene datos. Ver query 7 antes de agregar suggested_fee'
  END
FROM influencer_rate_cards;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INSTRUCCIONES DE REVISIÓN
--
-- Query 1+2 → Decide si el mapeo de status es correcto o ajustarlo.
-- Query 3   → Confirma que brand_id no rompe usuarios existentes.
-- Query 4   → Saber si ya hay marcas con login activo.
-- Query 5+6 → Decide si agregar suggested_fee o usar rate_cards como fuente.
-- Query 7   → Identifica conflicto potencial suggested_fee vs rate_cards.
-- Query 8   → Confirma campañas activas que no deben verse afectadas.
-- Query 9   → Resumen ejecutivo de riesgo en 3 líneas.
--
-- Después de revisar los resultados, proceder con MIGRATIONS_PORTAL_MARCA.sql
-- con los ajustes que correspondan.
-- ═══════════════════════════════════════════════════════════════════════════════
