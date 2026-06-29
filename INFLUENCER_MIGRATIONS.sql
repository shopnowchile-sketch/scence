-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — Influencer Portal Migrations
-- Run in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. INFLUENCER TASKS ───────────────────────────────────────────────────────
-- Auto-generated from campaigns, bookings, and events.
-- Influencers can also have manual tasks.

CREATE TABLE IF NOT EXISTS influencer_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  influencer_id   UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source_type IN ('campaign', 'booking', 'event', 'manual')),
  source_id       UUID,         -- FK to campaigns.id / bookings.id / events.id
  title           TEXT NOT NULL,
  description     TEXT,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'done', 'skipped')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_influencer_tasks_influencer ON influencer_tasks(influencer_id);
CREATE INDEX IF NOT EXISTS idx_influencer_tasks_status     ON influencer_tasks(status);
CREATE INDEX IF NOT EXISTS idx_influencer_tasks_source     ON influencer_tasks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_influencer_tasks_org        ON influencer_tasks(organization_id);

-- ── 2. RLS for influencer_tasks ───────────────────────────────────────────────
-- Influencers can only see/update their own tasks.
-- Org admins can see all tasks in their org.

ALTER TABLE influencer_tasks ENABLE ROW LEVEL SECURITY;

-- Influencers: see only their own tasks
CREATE POLICY IF NOT EXISTS "Influencers can view own tasks"
  ON influencer_tasks FOR SELECT
  USING (
    influencer_id IN (
      SELECT id FROM influencers WHERE user_id = auth.uid()
    )
    OR
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Influencers can update status of their own tasks
CREATE POLICY IF NOT EXISTS "Influencers can update own task status"
  ON influencer_tasks FOR UPDATE
  USING (
    influencer_id IN (
      SELECT id FROM influencers WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    influencer_id IN (
      SELECT id FROM influencers WHERE user_id = auth.uid()
    )
  );

-- Org members can insert tasks for their org
CREATE POLICY IF NOT EXISTS "Org members can insert tasks"
  ON influencer_tasks FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Org members can delete tasks in their org
CREATE POLICY IF NOT EXISTS "Org members can delete tasks"
  ON influencer_tasks FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOTE: influencers.user_id already exists in the base schema.
-- To give an influencer portal access, set their user_id in the influencers table:
--
--   UPDATE influencers SET user_id = '<auth_user_uuid>' WHERE id = '<influencer_id>';
--
-- The influencer must first register at /register (or be invited via email).
-- ═══════════════════════════════════════════════════════════════════════════════
