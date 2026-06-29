-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — MIGRATIONS V2 (safe to re-run)
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. campaign_deliverables.type → TEXT (libera el ENUM rígido) ─────────────
-- El ENUM deliverable_type no incluye reel, story, event_checkin, send_content, etc.
ALTER TABLE campaign_deliverables
  ALTER COLUMN type TYPE TEXT;

-- ── 2. influencers — columna address ─────────────────────────────────────────
ALTER TABLE influencers
  ADD COLUMN IF NOT EXISTS address TEXT;

-- ── 3. campaigns — commission_rate + CLP default ─────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);  -- % para campañas de comisión

ALTER TABLE campaigns
  ALTER COLUMN currency SET DEFAULT 'CLP';

-- ── 4. campaign_influencers — CLP default ────────────────────────────────────
ALTER TABLE campaign_influencers
  ALTER COLUMN currency SET DEFAULT 'CLP';

-- ── 5. campaign_deliverables — add content_url + submit fields ───────────────
-- Para el flujo: influencer sube contenido → equipo aprueba → publicado
ALTER TABLE campaign_deliverables
  ADD COLUMN IF NOT EXISTS content_url      TEXT,        -- link al contenido entregado
  ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ, -- cuando lo entregó el influencer
  ADD COLUMN IF NOT EXISTS submitted_notes  TEXT;        -- notas del influencer al entregar

-- ── 6. bookings — tabla multi-influencer ─────────────────────────────────────
-- bookings.influencer_id se mantiene para compatibilidad (influencer principal)
-- booking_influencers permite N influencers por booking
CREATE TABLE IF NOT EXISTS booking_influencers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  influencer_id   UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'confirmed', 'declined', 'attended', 'no_show')),
  confirmed_at    TIMESTAMPTZ,
  declined_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(booking_id, influencer_id)
);
CREATE INDEX IF NOT EXISTS idx_booking_influencers_booking    ON booking_influencers(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_influencers_influencer ON booking_influencers(influencer_id);

-- ── 7. bookings — add email_sent_at para tracking de invitaciones ────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_token TEXT UNIQUE;

-- ── 8. affiliate_links — comisión por link ───────────────────────────────────
ALTER TABLE affiliate_links
  ADD COLUMN IF NOT EXISTS commission_rate  NUMERIC(5,2) DEFAULT 0,   -- % por venta
  ADD COLUMN IF NOT EXISTS commission_fixed NUMERIC(12,2) DEFAULT 0,  -- monto fijo por conversión
  ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'CLP',
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT true;

-- ── 9. campaigns — social_tags (menciones obligatorias) ──────────────────────
-- mention_handles ya existe. Renombramos semánticamente via un alias en código.
-- No se requiere migration, mention_handles cumple el rol.

-- ── 10. Índices útiles ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_influencer
  ON campaign_deliverables(influencer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_status
  ON campaign_deliverables(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_active
  ON affiliate_links(organization_id) WHERE is_active = true;

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────
SELECT
  (SELECT column_name FROM information_schema.columns WHERE table_name='campaign_deliverables' AND column_name='content_url') AS del_content_url,
  (SELECT column_name FROM information_schema.columns WHERE table_name='influencers' AND column_name='address') AS inf_address,
  (SELECT column_name FROM information_schema.columns WHERE table_name='campaigns' AND column_name='commission_rate') AS camp_commission,
  (SELECT to_regclass('public.booking_influencers')) AS booking_influencers_table;

-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATIONS V2 — PARTE 2 (agregar después de las anteriores)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 11. campaigns — deliverable_templates JSONB ───────────────────────────────
-- Guarda los templates definidos al crear la campaña.
-- Formato: [{ type, quantity, description, due_date }]
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS deliverable_templates JSONB DEFAULT '[]'::jsonb;

-- ── 12. Fix currency defaults → CLP en todas las tablas ─────────────────────
ALTER TABLE campaigns         ALTER COLUMN currency SET DEFAULT 'CLP';
ALTER TABLE campaign_influencers ALTER COLUMN currency SET DEFAULT 'CLP';
ALTER TABLE invoices          ALTER COLUMN currency SET DEFAULT 'CLP';
ALTER TABLE payroll_items     ALTER COLUMN currency SET DEFAULT 'CLP';
ALTER TABLE bookings          ALTER COLUMN currency SET DEFAULT 'CLP';

-- ── 13. synced_at en influencer_social_profiles ───────────────────────────────
ALTER TABLE influencer_social_profiles
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_social_profiles_synced
  ON influencer_social_profiles(synced_at) WHERE synced_at IS NOT NULL;

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────
SELECT
  (SELECT column_name FROM information_schema.columns WHERE table_name='campaigns' AND column_name='deliverable_templates') AS camp_del_templates,
  (SELECT column_name FROM information_schema.columns WHERE table_name='influencer_social_profiles' AND column_name='synced_at') AS social_synced_at;
