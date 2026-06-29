-- ── Booking confirmations + campaign association ──────────────────────────────
-- Run in Supabase SQL Editor

-- Add confirmation_status to bookings if not exists
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending', 'confirmed', 'declined')),
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

-- Add progress to campaign_deliverables if not exists
ALTER TABLE campaign_deliverables
  ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0
    CHECK (progress IN (0, 25, 50, 75, 100));

-- Add social_tags and deliverable_templates to campaigns if not exists
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS social_tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deliverable_templates JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);

-- Add address and deactivation_reason to influencers (via metadata, no column needed)
-- is_active already exists; metadata JSONB already exists

-- Index for fast booking confirmation lookup
CREATE INDEX IF NOT EXISTS idx_bookings_influencer_created
  ON bookings (influencer_id, created_at DESC);

-- ── Done ─────────────────────────────────────────────────────────────────────
SELECT 'Migration completed' AS status;
