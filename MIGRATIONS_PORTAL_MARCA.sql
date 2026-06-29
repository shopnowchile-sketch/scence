-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — MIGRATIONS PORTAL MARCA (Fase 1)
-- Correr en: Supabase Dashboard → SQL Editor → Pegar todo → Run
-- Seguro de re-ejecutar: usa IF NOT EXISTS y comprobaciones de tipo
-- Fecha: 2026-06-03
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. campaigns — visibility ─────────────────────────────────────────────────
-- Distingue campañas privadas (marca invita) de abiertas (influencer postula)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'open'));

-- ── 2. campaigns — application_deadline ──────────────────────────────────────
-- Fecha límite para postulaciones. Solo aplica cuando visibility = 'open'.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS application_deadline DATE;

-- ── 3. campaigns — max_influencers ───────────────────────────────────────────
-- Cupo máximo de influencers por campaña. NULL = sin límite.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS max_influencers INTEGER;

CREATE INDEX IF NOT EXISTS idx_campaigns_visibility
  ON campaigns(visibility);

CREATE INDEX IF NOT EXISTS idx_campaigns_open_deadline
  ON campaigns(application_deadline)
  WHERE visibility = 'open' AND application_deadline IS NOT NULL;

-- ── 4. campaign_influencers — origin ─────────────────────────────────────────
-- 'invitation'  = la marca invitó al influencer (campaña private o open)
-- 'application' = el influencer postuló a una campaña open
ALTER TABLE campaign_influencers
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'invitation'
    CHECK (origin IN ('invitation', 'application'));

-- ── 5. campaign_influencers — message ────────────────────────────────────────
-- Texto libre de contexto.
-- En invitation: mensaje de la marca al influencer.
-- En application: mensaje del influencer a la marca.
ALTER TABLE campaign_influencers
  ADD COLUMN IF NOT EXISTS message TEXT;

-- ── 6. campaign_influencers — deliverables_spec ───────────────────────────────
-- Spec de deliverables acordada al momento de invitar o postular.
-- Inmutable una vez aceptada. Fuente de verdad: campaign_deliverables.
-- Formato: [{ "type": "reel", "quantity": 2, "platform": "instagram", "due_date": "2026-08-01" }]
ALTER TABLE campaign_influencers
  ADD COLUMN IF NOT EXISTS deliverables_spec JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── 7. campaign_influencers — migrar status de ENUM a TEXT ───────────────────
-- El ENUM campaign_status era incorrecto para este flujo.
-- Nuevo dominio: pending | accepted | rejected | expired | withdrawn
--
-- PRE-CHECK confirmado (2026-06-03):
--   draft  → 37 filas  (invitados sin respuesta)   → pending
--   active →  5 filas  (confirmados en campaña)    → accepted
-- No existen otros valores en producción. Mapeo exacto y sin pérdida.
--
-- IMPORTANTE: Postgres no permite cambiar un ENUM directamente a TEXT con CHECK.
-- Se agrega columna nueva, se migra, se mantiene la original como legacy.

-- 7a. Agregar columna nueva
ALTER TABLE campaign_influencers
  ADD COLUMN IF NOT EXISTS application_status TEXT
    CHECK (application_status IN ('pending', 'accepted', 'rejected', 'expired', 'withdrawn'));

-- 7b. Poblar con mapeo exacto (validado contra datos reales)
UPDATE campaign_influencers
SET application_status = CASE
  WHEN status::TEXT = 'draft'  THEN 'pending'
  WHEN status::TEXT = 'active' THEN 'accepted'
  ELSE 'pending'
END
WHERE application_status IS NULL;

-- 7c. Hacer NOT NULL con default
ALTER TABLE campaign_influencers
  ALTER COLUMN application_status SET NOT NULL,
  ALTER COLUMN application_status SET DEFAULT 'pending';

-- NOTA: La columna 'status' (ENUM campaign_status) queda como legacy.
-- No se dropea para no romper código existente.
-- El código del Portal Marca usará 'application_status'.
-- Programar DROP en migración futura cuando todo el código haya migrado.

CREATE INDEX IF NOT EXISTS idx_campaign_influencers_app_status
  ON campaign_influencers(application_status);

CREATE INDEX IF NOT EXISTS idx_campaign_influencers_origin
  ON campaign_influencers(origin);

-- ── 8. organization_members — brand_id ───────────────────────────────────────
-- Vincula un usuario miembro a una marca específica dentro de la org.
-- NULL = usuario admin (acceso a toda la org).
-- NOT NULL + role='brand_manager' = usuario del portal de esa marca.
ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_members_brand
  ON organization_members(brand_id)
  WHERE brand_id IS NOT NULL;

-- ── 9. influencers — suggested_fee ───────────────────────────────────────────
-- DECISIÓN (2026-06-03): EXCLUIDA de esta migración.
-- Motivo: influencer_rate_cards ya tiene tarifas por tipo de deliverable.
-- Agregar suggested_fee crearía ambigüedad entre dos fuentes de verdad.
-- Alternativa en código: leer MIN(base_rate) de rate_cards como tarifa de referencia.
-- Revisar en Fase 2 si la UX del catálogo requiere un campo de fee unificado.
-- ALTER TABLE influencers ADD COLUMN IF NOT EXISTS suggested_fee NUMERIC(12,2);

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────
-- Ejecutar después de las migraciones para confirmar que todo quedó correcto.

SELECT
  -- campaigns
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'visibility')             AS camp_visibility,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'application_deadline')   AS camp_app_deadline,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'max_influencers')        AS camp_max_influencers,

  -- campaign_influencers
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaign_influencers' AND column_name = 'origin')              AS ci_origin,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaign_influencers' AND column_name = 'message')             AS ci_message,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaign_influencers' AND column_name = 'deliverables_spec')   AS ci_deliverables_spec,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaign_influencers' AND column_name = 'application_status')  AS ci_application_status,

  -- organization_members
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'organization_members' AND column_name = 'brand_id')    AS om_brand_id,

  -- influencers (suggested_fee excluida — ver nota en sección 9)
  'suggested_fee_excluida'                                                     AS inf_suggested_fee;

-- RESULTADO ESPERADO: todas las columnas deben mostrar su nombre (no NULL).
-- Si alguna aparece NULL, esa columna no se creó — revisar errores arriba.

-- ═══════════════════════════════════════════════════════════════════════════════
-- RESUMEN
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Tablas modificadas:
--   campaigns           → +3 cols (visibility, application_deadline, max_influencers)
--   campaign_influencers → +4 cols (origin, message, deliverables_spec, application_status)
--   organization_members → +1 col (brand_id)
--   influencers          → SIN CAMBIOS (suggested_fee excluida, usar rate_cards)
--
-- Tablas creadas: NINGUNA
--
-- Índices creados: 5
--   idx_campaigns_visibility
--   idx_campaigns_open_deadline
--   idx_campaign_influencers_app_status
--   idx_campaign_influencers_origin
--   idx_org_members_brand
--
-- Columnas legacy (no dropeadas intencionalmente):
--   campaign_influencers.status (ENUM) — reemplazada por application_status
--   campaigns.approval_required        — obsoleta en modelo self-service
-- ═══════════════════════════════════════════════════════════════════════════════
