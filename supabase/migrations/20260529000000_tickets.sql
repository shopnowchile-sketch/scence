-- ============================================================
-- SCENCE APP — Tickets (bug / support ticket system)
-- ============================================================

CREATE TABLE IF NOT EXISTS tickets (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES auth.users(id),

  title            TEXT NOT NULL,
  description      TEXT NOT NULL,

  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'in_progress', 'closed')),

  priority         TEXT NOT NULL DEFAULT 'P2'
                   CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),

  category         TEXT NOT NULL DEFAULT 'other'
                   CHECK (category IN ('ui', 'api', 'data', 'auth', 'billing', 'performance', 'other')),

  -- Claude AI review stored as JSONB
  -- shape: { severity, category, summary, suggested_steps[], estimated_priority }
  ai_review        JSONB,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for org-scoped queries (main access pattern)
CREATE INDEX IF NOT EXISTS idx_tickets_org_id     ON tickets (organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status      ON tickets (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at  ON tickets (organization_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Disable RLS (API routes use admin client + org-scoped WHERE clauses)
ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
