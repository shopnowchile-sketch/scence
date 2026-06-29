-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — MIGRATIONS FASE 1 (safe to re-run, uses IF NOT EXISTS)
-- Correr en: Supabase Dashboard → SQL Editor → Pegar todo → Run
-- Fixes: BUG-1 (content_url, submitted_at, submitted_notes) + BUG-5 (progress)
--        + columnas de MIGRATIONS_V2.sql que pueden estar pendientes
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. campaign_deliverables.type → TEXT (libera el ENUM rígido) ─────────────
ALTER TABLE campaign_deliverables
  ALTER COLUMN type TYPE TEXT;

-- ── 2. campaign_deliverables — columnas para submit de influencer ─────────────
ALTER TABLE campaign_deliverables
  ADD COLUMN IF NOT EXISTS content_url      TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_notes  TEXT;

-- ── 3. campaign_deliverables — columna progress ───────────────────────────────
ALTER TABLE campaign_deliverables
  ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;

-- ── 4. influencers — columna address ─────────────────────────────────────────
ALTER TABLE influencers
  ADD COLUMN IF NOT EXISTS address TEXT;

-- ── 5. campaigns — commission_rate + deliverable_templates + CLP default ──────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS commission_rate        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS deliverable_templates  JSONB DEFAULT '[]'::jsonb;

ALTER TABLE campaigns
  ALTER COLUMN currency SET DEFAULT 'CLP';

-- ── 6. campaign_influencers — CLP default ────────────────────────────────────
ALTER TABLE campaign_influencers
  ALTER COLUMN currency SET DEFAULT 'CLP';

-- ── 7. invoices, payroll_items, bookings — CLP default ───────────────────────
ALTER TABLE invoices       ALTER COLUMN currency SET DEFAULT 'CLP';
ALTER TABLE payroll_items  ALTER COLUMN currency SET DEFAULT 'CLP';
ALTER TABLE bookings       ALTER COLUMN currency SET DEFAULT 'CLP';

-- ── 8. booking_influencers — tabla multi-influencer por booking ───────────────
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
CREATE INDEX IF NOT EXISTS idx_booking_influencers_booking
  ON booking_influencers(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_influencers_influencer
  ON booking_influencers(influencer_id);

-- ── 9. bookings — columnas para email de confirmación ────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS email_sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_token  TEXT UNIQUE;

-- ── 10. influencer_social_profiles — synced_at ───────────────────────────────
ALTER TABLE influencer_social_profiles
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_social_profiles_synced
  ON influencer_social_profiles(synced_at) WHERE synced_at IS NOT NULL;

-- ── 11. campaigns — índice para brand_id ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_influencer
  ON campaign_deliverables(influencer_id);

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────
SELECT
  (SELECT column_name FROM information_schema.columns
    WHERE table_name='campaign_deliverables' AND column_name='content_url')      AS content_url,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name='campaign_deliverables' AND column_name='submitted_at')     AS submitted_at,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name='campaign_deliverables' AND column_name='submitted_notes')  AS submitted_notes,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name='campaign_deliverables' AND column_name='progress')         AS progress,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name='influencers' AND column_name='address')                    AS inf_address,
  (SELECT column_name FROM information_schema.columns
    WHERE table_name='campaigns' AND column_name='commission_rate')              AS commission_rate,
  (SELECT to_regclass('public.booking_influencers'))                             AS booking_influencers;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RESULTADO ESPERADO: todas las columnas deben mostrar su nombre (no NULL)
-- Si alguna aparece NULL, esa columna no se creó — revisar errores arriba.
-- ═══════════════════════════════════════════════════════════════════════════════
