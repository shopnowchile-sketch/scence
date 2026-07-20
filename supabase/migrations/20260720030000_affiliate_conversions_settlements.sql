-- Conversiones trazables y liquidaciones de afiliados.
-- Los contadores históricos de affiliate_links se conservan como agregados.

DO $$ BEGIN
  CREATE TYPE public.affiliate_conversion_status AS ENUM ('pending', 'confirmed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.commission_settlement_status AS ENUM ('pending', 'paid', 'problem');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.affiliate_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  affiliate_link_id uuid NOT NULL REFERENCES public.affiliate_links(id) ON DELETE CASCADE,
  influencer_id uuid NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  barter_benefit_id uuid REFERENCES public.barter_benefits(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('scence', 'webhook', 'coupon', 'csv', 'manual')),
  external_sale_id text,
  sale_amount numeric(14,2) NOT NULL CHECK (sale_amount >= 0),
  currency text NOT NULL DEFAULT 'CLP',
  commission_rate numeric(7,4) NOT NULL CHECK (commission_rate > 0 AND commission_rate <= 100),
  commission_amount numeric(14,2) GENERATED ALWAYS AS
    (round(sale_amount * commission_rate / 100, 2)) STORED,
  status public.affiliate_conversion_status NOT NULL DEFAULT 'pending',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_conversions_external_sale_unique
  ON public.affiliate_conversions (organization_id, source, external_sale_id)
  WHERE external_sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_conversions_link_date
  ON public.affiliate_conversions (affiliate_link_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_conversions_org_status
  ON public.affiliate_conversions (organization_id, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_conversions_influencer
  ON public.affiliate_conversions (influencer_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.commission_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id uuid NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  status public.commission_settlement_status NOT NULL DEFAULT 'pending',
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'CLP',
  period_start date,
  period_end date,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  payroll_item_id uuid REFERENCES public.payroll_items(id) ON DELETE SET NULL,
  influencer_document_url text,
  notes text,
  paid_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.commission_settlement_conversions (
  settlement_id uuid NOT NULL REFERENCES public.commission_settlements(id) ON DELETE CASCADE,
  conversion_id uuid NOT NULL UNIQUE REFERENCES public.affiliate_conversions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (settlement_id, conversion_id)
);

CREATE INDEX IF NOT EXISTS commission_settlements_org_status
  ON public.commission_settlements (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS commission_settlements_influencer
  ON public.commission_settlements (influencer_id, created_at DESC);

ALTER TABLE public.affiliate_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_settlement_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS affiliate_conversions_org_members ON public.affiliate_conversions;
CREATE POLICY affiliate_conversions_org_members ON public.affiliate_conversions
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = affiliate_conversions.organization_id
    AND om.user_id = auth.uid() AND om.is_active = true
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = affiliate_conversions.organization_id
    AND om.user_id = auth.uid() AND om.is_active = true
));

DROP POLICY IF EXISTS affiliate_conversions_influencer_read ON public.affiliate_conversions;
CREATE POLICY affiliate_conversions_influencer_read ON public.affiliate_conversions
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.influencers i
  WHERE i.id = affiliate_conversions.influencer_id AND i.user_id = auth.uid()
));

DROP POLICY IF EXISTS commission_settlements_org_members ON public.commission_settlements;
CREATE POLICY commission_settlements_org_members ON public.commission_settlements
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = commission_settlements.organization_id
    AND om.user_id = auth.uid() AND om.is_active = true
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = commission_settlements.organization_id
    AND om.user_id = auth.uid() AND om.is_active = true
));

DROP POLICY IF EXISTS commission_settlements_influencer_read ON public.commission_settlements;
CREATE POLICY commission_settlements_influencer_read ON public.commission_settlements
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.influencers i
  WHERE i.id = commission_settlements.influencer_id AND i.user_id = auth.uid()
));

DROP POLICY IF EXISTS commission_settlement_conversions_org_members
  ON public.commission_settlement_conversions;
CREATE POLICY commission_settlement_conversions_org_members
ON public.commission_settlement_conversions
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.commission_settlements s
  JOIN public.organization_members om ON om.organization_id = s.organization_id
  WHERE s.id = commission_settlement_conversions.settlement_id
    AND om.user_id = auth.uid() AND om.is_active = true
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.commission_settlements s
  JOIN public.organization_members om ON om.organization_id = s.organization_id
  WHERE s.id = commission_settlement_conversions.settlement_id
    AND om.user_id = auth.uid() AND om.is_active = true
));

CREATE OR REPLACE FUNCTION public.refresh_affiliate_link_totals(p_link_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.affiliate_links link
  SET
    conversions = totals.conversions,
    revenue = totals.revenue,
    updated_at = now()
  FROM (
    SELECT
      count(*) FILTER (WHERE status = 'confirmed')::integer AS conversions,
      COALESCE(sum(sale_amount) FILTER (WHERE status = 'confirmed'), 0) AS revenue
    FROM public.affiliate_conversions
    WHERE affiliate_link_id = p_link_id
  ) totals
  WHERE link.id = p_link_id;
$$;

CREATE OR REPLACE FUNCTION public.sync_affiliate_link_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_affiliate_link_totals(COALESCE(NEW.affiliate_link_id, OLD.affiliate_link_id));
  IF TG_OP = 'UPDATE' AND NEW.affiliate_link_id IS DISTINCT FROM OLD.affiliate_link_id THEN
    PERFORM public.refresh_affiliate_link_totals(OLD.affiliate_link_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_affiliate_link_totals ON public.affiliate_conversions;
CREATE TRIGGER trg_sync_affiliate_link_totals
AFTER INSERT OR UPDATE OR DELETE ON public.affiliate_conversions
FOR EACH ROW EXECUTE FUNCTION public.sync_affiliate_link_totals();

CREATE OR REPLACE FUNCTION public.increment_affiliate_link_clicks(p_link_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.affiliate_links
  SET clicks = COALESCE(clicks, 0) + 1, updated_at = now()
  WHERE id = p_link_id AND is_active = true;
$$;
