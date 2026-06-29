-- ─────────────────────────────────────────────────────────────────────────────
-- SCENCE — Stripe + Resend columns
-- Run in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Add Stripe subscription columns to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan        TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_period_end  TIMESTAMPTZ;

-- Index for webhook lookups (find org by stripe_customer_id)
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer
  ON organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Index for subscription status queries (plan gating)
CREATE INDEX IF NOT EXISTS idx_organizations_subscription_status
  ON organizations (subscription_status)
  WHERE subscription_status IS NOT NULL;
