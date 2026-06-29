-- ============================================================
-- SCENCE APP — DATABASE SCHEMA v1.0
-- Stack: Supabase (PostgreSQL 15)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('super_admin', 'agency_manager', 'brand_manager', 'influencer', 'finance');
CREATE TYPE org_type AS ENUM ('brand', 'agency');
CREATE TYPE subscription_tier AS ENUM ('starter', 'growth', 'pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'paused');
CREATE TYPE campaign_status AS ENUM ('draft', 'pending_approval', 'active', 'paused', 'completed', 'canceled');
CREATE TYPE campaign_type AS ENUM ('sponsored_post', 'event_appearance', 'ambassador', 'product_seeding', 'ugc', 'live');
CREATE TYPE booking_status AS ENUM ('proposed', 'confirmed', 'completed', 'canceled', 'no_show');
CREATE TYPE deliverable_type AS ENUM ('instagram_post', 'instagram_story', 'instagram_reel', 'tiktok', 'youtube', 'youtube_short', 'blog', 'podcast', 'event_appearance', 'live_stream', 'ugc_video', 'ugc_photo');
CREATE TYPE deliverable_status AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'published');
CREATE TYPE contract_status AS ENUM ('draft', 'sent', 'signed', 'expired', 'voided');
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void', 'partially_paid');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded');
CREATE TYPE payroll_status AS ENUM ('pending', 'approved', 'processing', 'paid', 'failed');
CREATE TYPE social_platform AS ENUM ('instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin', 'pinterest', 'twitch', 'snapchat');
CREATE TYPE currency_code AS ENUM ('USD', 'EUR', 'MXN', 'CLP', 'COP', 'ARS', 'BRL', 'GBP');
CREATE TYPE notification_type AS ENUM ('campaign_update', 'deliverable_review', 'payment', 'contract', 'booking', 'system');

-- ============================================================
-- CORE: USERS & PROFILES
-- ============================================================

-- Extends Supabase auth.users
CREATE TABLE public.profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  display_name      TEXT,
  avatar_url        TEXT,
  phone             TEXT,
  timezone          TEXT DEFAULT 'America/Mexico_City',
  locale            TEXT DEFAULT 'es',
  role              user_role NOT NULL DEFAULT 'brand_manager',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  onboarded_at      TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ORGANIZATIONS (Brands & Agencies)
-- ============================================================

CREATE TABLE public.organizations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  type              org_type NOT NULL DEFAULT 'brand',
  logo_url          TEXT,
  website           TEXT,
  industry          TEXT,
  country           TEXT DEFAULT 'MX',
  address           JSONB DEFAULT '{}',
  tax_id            TEXT,
  billing_email     TEXT,
  currency          currency_code NOT NULL DEFAULT 'USD',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  settings          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.organization_members (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role              user_role NOT NULL DEFAULT 'brand_manager',
  is_owner          BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by        UUID REFERENCES profiles(id),
  invited_at        TIMESTAMPTZ,
  joined_at         TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- ============================================================
-- SUBSCRIPTIONS (SaaS B2B)
-- ============================================================

CREATE TABLE public.subscription_plans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier              subscription_tier NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  price_monthly     NUMERIC(10,2) NOT NULL,
  price_yearly      NUMERIC(10,2),
  max_users         INTEGER,
  max_campaigns     INTEGER,
  max_influencers   INTEGER,
  features          JSONB NOT NULL DEFAULT '[]',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.subscriptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL REFERENCES subscription_plans(id),
  status            subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ NOT NULL,
  trial_ends_at     TIMESTAMPTZ,
  canceled_at       TIMESTAMPTZ,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id     TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INFLUENCERS
-- ============================================================

CREATE TABLE public.influencers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
  organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL, -- agency roster
  display_name      TEXT NOT NULL,
  bio               TEXT,
  avatar_url        TEXT,
  cover_url         TEXT,
  email             TEXT,
  phone             TEXT,
  whatsapp          TEXT,
  country           TEXT,
  city              TEXT,
  timezone          TEXT DEFAULT 'America/Mexico_City',
  language          TEXT[] DEFAULT ARRAY['es'],
  categories        TEXT[] DEFAULT ARRAY[]::TEXT[],  -- e.g. fashion, beauty, fitness
  tags              TEXT[] DEFAULT ARRAY[]::TEXT[],
  gender            TEXT,
  age_range         TEXT,
  audience_age_range TEXT,
  audience_gender_split JSONB,  -- { female: 0.7, male: 0.3 }
  audience_countries JSONB,     -- { MX: 0.5, US: 0.2 }
  is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  rating            NUMERIC(3,2) DEFAULT 0, -- 0-5 score from brands
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.influencer_social_profiles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  influencer_id     UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  platform          social_platform NOT NULL,
  username          TEXT NOT NULL,
  profile_url       TEXT,
  followers         INTEGER DEFAULT 0,
  following         INTEGER DEFAULT 0,
  engagement_rate   NUMERIC(5,2) DEFAULT 0,   -- percentage
  avg_likes         INTEGER DEFAULT 0,
  avg_comments      INTEGER DEFAULT 0,
  avg_views         INTEGER DEFAULT 0,
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at    TIMESTAMPTZ,
  raw_data          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(influencer_id, platform)
);

CREATE TABLE public.influencer_rate_cards (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  influencer_id     UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  deliverable_type  deliverable_type NOT NULL,
  base_rate         NUMERIC(12,2) NOT NULL,
  currency          currency_code NOT NULL DEFAULT 'USD',
  includes_usage_rights BOOLEAN DEFAULT FALSE,
  usage_rights_duration_days INTEGER,
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(influencer_id, deliverable_type)
);

-- ============================================================
-- CAMPAIGNS
-- ============================================================

CREATE TABLE public.campaigns (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES profiles(id),
  name              TEXT NOT NULL,
  description       TEXT,
  brief_url         TEXT,
  type              campaign_type NOT NULL DEFAULT 'sponsored_post',
  status            campaign_status NOT NULL DEFAULT 'draft',
  start_date        DATE,
  end_date          DATE,
  budget_total      NUMERIC(14,2),
  budget_spent      NUMERIC(14,2) DEFAULT 0,
  currency          currency_code NOT NULL DEFAULT 'USD',
  goals             JSONB DEFAULT '{}',   -- { impressions: 100000, engagement_rate: 5 }
  hashtags          TEXT[] DEFAULT ARRAY[]::TEXT[],
  mention_handles   TEXT[] DEFAULT ARRAY[]::TEXT[],
  platforms         social_platform[] DEFAULT ARRAY[]::social_platform[],
  do_follow_links   TEXT[],
  content_guidelines TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  internal_notes    TEXT,
  tags              TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.campaign_influencers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  influencer_id     UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  status            campaign_status NOT NULL DEFAULT 'draft',
  fee               NUMERIC(12,2),
  currency          currency_code NOT NULL DEFAULT 'USD',
  fee_includes_taxes BOOLEAN DEFAULT FALSE,
  payment_terms     TEXT,
  usage_rights      TEXT,
  exclusivity_days  INTEGER DEFAULT 0,
  invited_at        TIMESTAMPTZ,
  accepted_at       TIMESTAMPTZ,
  rejected_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, influencer_id)
);

CREATE TABLE public.campaign_deliverables (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_influencer_id UUID REFERENCES campaign_influencers(id) ON DELETE CASCADE,
  influencer_id     UUID REFERENCES influencers(id),
  type              deliverable_type NOT NULL,
  title             TEXT,
  description       TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1,
  status            deliverable_status NOT NULL DEFAULT 'pending',
  due_date          DATE,
  published_at      TIMESTAMPTZ,
  published_url     TEXT,
  platform          social_platform,
  caption           TEXT,
  hashtags          TEXT[],
  review_notes      TEXT,
  reviewed_by       UUID REFERENCES profiles(id),
  reviewed_at       TIMESTAMPTZ,
  performance       JSONB DEFAULT '{}', -- { views, likes, comments, shares, saves, reach }
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.campaign_status_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  changed_by        UUID NOT NULL REFERENCES profiles(id),
  from_status       campaign_status,
  to_status         campaign_status NOT NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BOOKINGS / EVENTS
-- ============================================================

CREATE TABLE public.bookings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  influencer_id     UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES profiles(id),
  title             TEXT NOT NULL,
  description       TEXT,
  status            booking_status NOT NULL DEFAULT 'proposed',
  event_type        TEXT,  -- shoot, event, meeting, live, etc.
  location          TEXT,
  location_details  JSONB DEFAULT '{}',
  is_virtual        BOOLEAN DEFAULT FALSE,
  virtual_link      TEXT,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  confirmed_at      TIMESTAMPTZ,
  canceled_at       TIMESTAMPTZ,
  cancellation_reason TEXT,
  fee               NUMERIC(12,2),
  currency          currency_code DEFAULT 'USD',
  travel_covered    BOOLEAN DEFAULT FALSE,
  travel_budget     NUMERIC(10,2),
  wardrobe_provided BOOLEAN DEFAULT FALSE,
  notes             TEXT,
  internal_notes    TEXT,
  calendar_event_id TEXT,  -- Google Calendar / iCal sync
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.booking_checkins (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id        UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  checked_in_by     UUID REFERENCES profiles(id),
  checked_in_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT,
  location_lat      NUMERIC(10,7),
  location_lng      NUMERIC(10,7)
);

-- ============================================================
-- CONTRACTS
-- ============================================================

CREATE TABLE public.contracts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_influencer_id UUID REFERENCES campaign_influencers(id) ON DELETE SET NULL,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  influencer_id     UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES profiles(id),
  title             TEXT NOT NULL,
  status            contract_status NOT NULL DEFAULT 'draft',
  template_id       UUID,  -- future: contract_templates table
  document_url      TEXT,
  signed_document_url TEXT,
  total_value       NUMERIC(14,2),
  currency          currency_code DEFAULT 'USD',
  start_date        DATE,
  end_date          DATE,
  sent_at           TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  signed_at         TIMESTAMPTZ,
  voided_at         TIMESTAMPTZ,
  void_reason       TEXT,
  docusign_envelope_id TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.contract_signatures (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id       UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  signer_name       TEXT NOT NULL,
  signer_email      TEXT NOT NULL,
  signer_role       TEXT,  -- 'brand', 'influencer', 'agency'
  signed_at         TIMESTAMPTZ,
  ip_address        INET,
  signature_data    TEXT,  -- base64 or reference
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BILLING (Invoices to Brands)
-- ============================================================

CREATE TABLE public.invoices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number    TEXT UNIQUE NOT NULL,  -- SCN-2024-0001
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  issued_by         UUID NOT NULL REFERENCES profiles(id),
  status            invoice_status NOT NULL DEFAULT 'draft',
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate          NUMERIC(5,2) DEFAULT 0,
  tax_amount        NUMERIC(14,2) DEFAULT 0,
  discount_amount   NUMERIC(14,2) DEFAULT 0,
  total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency          currency_code NOT NULL DEFAULT 'USD',
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE NOT NULL,
  paid_at           TIMESTAMPTZ,
  payment_reference TEXT,
  notes             TEXT,
  terms             TEXT,
  pdf_url           TEXT,
  stripe_invoice_id TEXT UNIQUE,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.invoice_line_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  campaign_influencer_id UUID REFERENCES campaign_influencers(id),
  deliverable_id    UUID REFERENCES campaign_deliverables(id),
  description       TEXT NOT NULL,
  quantity          NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price        NUMERIC(12,2) NOT NULL,
  discount_percent  NUMERIC(5,2) DEFAULT 0,
  amount            NUMERIC(14,2) NOT NULL,  -- qty * unit_price * (1 - discount)
  currency          currency_code NOT NULL DEFAULT 'USD',
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  amount            NUMERIC(14,2) NOT NULL,
  currency          currency_code NOT NULL DEFAULT 'USD',
  status            payment_status NOT NULL DEFAULT 'pending',
  payment_method    TEXT,  -- wire, card, paypal, crypto
  payment_reference TEXT,
  gateway           TEXT,  -- stripe, paypal, bank
  gateway_payment_id TEXT,
  paid_at           TIMESTAMPTZ,
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PAYROLL (Payments to Influencers)
-- ============================================================

CREATE TABLE public.payroll_runs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  created_by        UUID NOT NULL REFERENCES profiles(id),
  title             TEXT NOT NULL,
  status            payroll_status NOT NULL DEFAULT 'pending',
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency          currency_code NOT NULL DEFAULT 'USD',
  approved_by       UUID REFERENCES profiles(id),
  approved_at       TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.payroll_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_run_id    UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  influencer_id     UUID NOT NULL REFERENCES influencers(id),
  campaign_influencer_id UUID REFERENCES campaign_influencers(id),
  status            payroll_status NOT NULL DEFAULT 'pending',
  gross_amount      NUMERIC(12,2) NOT NULL,
  tax_withholding   NUMERIC(12,2) DEFAULT 0,
  platform_fee      NUMERIC(12,2) DEFAULT 0,
  net_amount        NUMERIC(12,2) NOT NULL,
  currency          currency_code NOT NULL DEFAULT 'USD',
  payment_method_id UUID,  -- ref to influencer_payment_methods
  payment_reference TEXT,
  gateway_payment_id TEXT,
  paid_at           TIMESTAMPTZ,
  failure_reason    TEXT,
  description       TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.influencer_payment_methods (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  influencer_id     UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,  -- bank_transfer, paypal, wise, crypto
  alias             TEXT,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  details           JSONB NOT NULL DEFAULT '{}',  -- encrypted bank details
  is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MEDIA & FILES
-- ============================================================

CREATE TABLE public.media_files (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  deliverable_id    UUID REFERENCES campaign_deliverables(id) ON DELETE SET NULL,
  uploaded_by       UUID NOT NULL REFERENCES profiles(id),
  filename          TEXT NOT NULL,
  storage_path      TEXT NOT NULL,  -- Supabase Storage path
  mime_type         TEXT,
  size_bytes        BIGINT,
  width             INTEGER,
  height            INTEGER,
  duration_seconds  NUMERIC(10,2),
  thumbnail_url     TEXT,
  is_public         BOOLEAN DEFAULT FALSE,
  tags              TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE public.notifications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type              notification_type NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  action_url        TEXT,
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  read_at           TIMESTAMPTZ,
  sent_via          TEXT[] DEFAULT ARRAY[]::TEXT[],  -- ['email', 'push', 'in_app']
  entity_type       TEXT,  -- 'campaign', 'invoice', etc.
  entity_id         UUID,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE public.audit_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,  -- 'campaign.created', 'invoice.sent', etc.
  entity_type       TEXT NOT NULL,
  entity_id         UUID,
  changes           JSONB DEFAULT '{}',
  ip_address        INET,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Organizations
CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

-- Influencers
CREATE INDEX idx_influencers_org ON influencers(organization_id);
CREATE INDEX idx_influencers_categories ON influencers USING gin(categories);
CREATE INDEX idx_influencers_tags ON influencers USING gin(tags);
CREATE INDEX idx_social_profiles_influencer ON influencer_social_profiles(influencer_id);
CREATE INDEX idx_social_profiles_platform ON influencer_social_profiles(platform);

-- Campaigns
CREATE INDEX idx_campaigns_org ON campaigns(organization_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_dates ON campaigns(start_date, end_date);
CREATE INDEX idx_campaign_influencers_campaign ON campaign_influencers(campaign_id);
CREATE INDEX idx_campaign_influencers_influencer ON campaign_influencers(influencer_id);
CREATE INDEX idx_deliverables_campaign ON campaign_deliverables(campaign_id);
CREATE INDEX idx_deliverables_status ON campaign_deliverables(status);

-- Bookings
CREATE INDEX idx_bookings_influencer ON bookings(influencer_id);
CREATE INDEX idx_bookings_campaign ON bookings(campaign_id);
CREATE INDEX idx_bookings_dates ON bookings(starts_at, ends_at);
CREATE INDEX idx_bookings_status ON bookings(status);

-- Billing
CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_campaign ON invoices(campaign_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- Payroll
CREATE INDEX idx_payroll_runs_org ON payroll_runs(organization_id);
CREATE INDEX idx_payroll_items_run ON payroll_items(payroll_run_id);
CREATE INDEX idx_payroll_items_influencer ON payroll_items(influencer_id);

-- Notifications
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read);
CREATE INDEX idx_notifications_entity ON notifications(entity_type, entity_id);

-- Audit
CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- ============================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE influencers ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile
CREATE POLICY "profiles_own" ON profiles
  USING (id = auth.uid());

-- Org members can see their org
CREATE POLICY "orgs_member_read" ON organizations
  USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Campaigns visible to org members
CREATE POLICY "campaigns_org_read" ON campaigns
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Influencers see their own campaign assignments
CREATE POLICY "campaign_influencers_self_read" ON campaign_influencers
  USING (
    influencer_id IN (
      SELECT id FROM influencers WHERE user_id = auth.uid()
    )
    OR
    campaign_id IN (
      SELECT c.id FROM campaigns c
      JOIN organization_members om ON om.organization_id = c.organization_id
      WHERE om.user_id = auth.uid() AND om.is_active = TRUE
    )
  );

-- Notifications: only recipient can read
CREATE POLICY "notifications_own" ON notifications
  USING (recipient_id = auth.uid());

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','organizations','organization_members','subscriptions',
    'influencers','influencer_social_profiles','influencer_rate_cards',
    'campaigns','campaign_influencers','campaign_deliverables',
    'bookings','contracts','invoices','payments',
    'payroll_runs','payroll_items','influencer_payment_methods'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      t
    );
  END LOOP;
END $$;

-- Auto-generate invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO seq
  FROM invoices
  WHERE organization_id = NEW.organization_id;

  NEW.invoice_number = 'SCN-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW
  WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
  EXECUTE FUNCTION generate_invoice_number();

-- Update budget_spent on campaign when payroll item is paid
CREATE OR REPLACE FUNCTION update_campaign_budget_spent()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE campaigns
    SET budget_spent = budget_spent + NEW.net_amount
    WHERE id = (
      SELECT campaign_id FROM payroll_runs WHERE id = NEW.payroll_run_id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_budget_spent
  AFTER UPDATE ON payroll_items
  FOR EACH ROW
  EXECUTE FUNCTION update_campaign_budget_spent();

-- ============================================================
-- SEED: Subscription Plans
-- ============================================================

INSERT INTO subscription_plans (tier, name, description, price_monthly, price_yearly, max_users, max_campaigns, max_influencers, features) VALUES
('starter',    'Starter',    'Para marcas pequeñas',          299,   2990,   3,    5,   50,  '["Campaigns","Bookings","Basic Reports"]'),
('growth',     'Growth',     'Para equipos en crecimiento',   799,   7990,   10,   20,  200, '["Campaigns","Bookings","Payroll","Contracts","Reports"]'),
('pro',        'Pro',        'Para agencias y marcas medianas',1999,  19990,  25,   100, 1000,'["All Growth","Custom Billing","API Access","Priority Support"]'),
('enterprise', 'Enterprise', 'Plan personalizado',            0,     0,      NULL, NULL,NULL, '["All Pro","Dedicated CSM","SLA","Custom Integrations","White Label"]');
