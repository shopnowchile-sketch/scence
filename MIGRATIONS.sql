-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — SQL Migrations (run in Supabase Dashboard → SQL Editor)
-- Session: 2026-05-29 | All new modules + schema updates
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. ORGANIZATIONS — Google Calendar & Stripe columns ──────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan        TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_period_end  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_access_token      TEXT,
  ADD COLUMN IF NOT EXISTS google_refresh_token     TEXT,
  ADD COLUMN IF NOT EXISTS google_token_expiry      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer
  ON organizations (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ── 2. BRANDS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id),
  name             TEXT NOT NULL,
  logo_url         TEXT,
  website          TEXT,
  industry         TEXT,
  contact_name     TEXT,
  contact_email    TEXT,
  contact_phone    TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brands_org ON brands(organization_id);

-- ── 3. CAMPAIGNS — add brand_id ───────────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns(brand_id) WHERE brand_id IS NOT NULL;

-- ── 4. INVOICES — add brand_id ────────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;

-- ── 5. CONTRACT TEMPLATES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id),
  name             TEXT NOT NULL,
  campaign_type    TEXT NOT NULL DEFAULT 'sponsored_post',
  content          TEXT NOT NULL DEFAULT '',
  variables        JSONB DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_templates_org ON contract_templates(organization_id);

-- ── 6. TICKETS (bug / support) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'in_progress', 'closed')),
  priority         TEXT NOT NULL DEFAULT 'P2'
                     CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  category         TEXT,
  ai_review        JSONB,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_org    ON tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

-- ── 7. AFFILIATE LINKS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  influencer_id    UUID REFERENCES influencers(id) ON DELETE SET NULL,
  campaign_id      UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  name             TEXT,
  code             TEXT NOT NULL UNIQUE,
  redirect_url     TEXT NOT NULL,
  full_link        TEXT,
  clicks           INTEGER NOT NULL DEFAULT 0,
  conversions      INTEGER NOT NULL DEFAULT 0,
  revenue          NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_org          ON affiliate_links(organization_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_code         ON affiliate_links(code);
CREATE INDEX IF NOT EXISTS idx_affiliate_influencer   ON affiliate_links(influencer_id);

-- ── 8. EVENTS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id      UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES auth.users(id),
  name             TEXT NOT NULL,
  description      TEXT,
  event_date       TIMESTAMPTZ NOT NULL,
  location         TEXT,
  is_virtual       BOOLEAN NOT NULL DEFAULT false,
  virtual_link     TEXT,
  capacity         INTEGER,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'canceled', 'completed')),
  image_url        TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_org    ON events(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_date   ON events(event_date);

-- ── 9. EVENT TICKET TYPES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_ticket_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  price            NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  quantity_total   INTEGER NOT NULL DEFAULT 0,
  quantity_sold    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_types_event ON event_ticket_types(event_id);

-- ── 10. TICKET SALES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_sales (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id   UUID NOT NULL REFERENCES event_ticket_types(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  buyer_name       TEXT NOT NULL,
  buyer_email      TEXT NOT NULL,
  buyer_phone      TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  unit_price       NUMERIC(12,2) NOT NULL,
  total_amount     NUMERIC(12,2) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  status           TEXT NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('pending', 'confirmed', 'canceled', 'refunded')),
  payment_method   TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_sales_event ON ticket_sales(event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sales_org   ON ticket_sales(organization_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERCEL ENV VARS TO ADD (Settings → Environment Variables)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Google Calendar (Service Account):
--   GOOGLE_SERVICE_ACCOUNT_EMAIL   = your-sa@project.iam.gserviceaccount.com
--   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = -----BEGIN PRIVATE KEY-----\n...
--   GOOGLE_CALENDAR_ID             = primary  (or your shared calendar ID)
--
-- Google OAuth (per-org, optional alternative):
--   GOOGLE_CLIENT_ID               = xxx.apps.googleusercontent.com
--   GOOGLE_CLIENT_SECRET           = GOCSPX-...
--
-- Social Sync (Apify):
--   APIFY_API_TOKEN                = apify_api_xxx
--
-- Already configured (check if missing):
--   ANTHROPIC_API_KEY              = sk-ant-...   (for AI Campaign Builder + ticket review)
--   NEXT_PUBLIC_APP_URL            = https://scence-app.vercel.app
--
-- ═══════════════════════════════════════════════════════════════════════════════
