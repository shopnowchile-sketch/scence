-- Canjes simples y escalables: múltiples beneficios estructurados.
-- No elimina ni reescribe datos históricos de public.barters.

DO $$ BEGIN
  CREATE TYPE public.barter_simple_status AS ENUM ('pending', 'completed', 'problem');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.barter_benefit_type AS ENUM (
    'product',
    'experience',
    'meal',
    'ticket',
    'gift_card',
    'service',
    'sales_commission',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.barters
  ADD COLUMN IF NOT EXISTS simple_status public.barter_simple_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

UPDATE public.barters
SET simple_status = CASE
  WHEN status = 'cerrado' THEN 'completed'::public.barter_simple_status
  WHEN status = 'con_problema' THEN 'problem'::public.barter_simple_status
  ELSE 'pending'::public.barter_simple_status
END
WHERE simple_status = 'pending';

CREATE TABLE IF NOT EXISTS public.barter_benefits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  barter_id uuid NOT NULL REFERENCES public.barters(id) ON DELETE CASCADE,
  benefit_type public.barter_benefit_type NOT NULL,
  description text,
  fixed_value numeric(14,2),
  currency text NOT NULL DEFAULT 'CLP',
  commission_rate numeric(7,4),
  affiliate_link_id uuid REFERENCES public.affiliate_links(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barter_benefits_value_check CHECK (
    (
      benefit_type = 'sales_commission'
      AND commission_rate IS NOT NULL
      AND commission_rate > 0
      AND commission_rate <= 100
      AND fixed_value IS NULL
    )
    OR
    (
      benefit_type <> 'sales_commission'
      AND fixed_value IS NOT NULL
      AND fixed_value >= 0
      AND commission_rate IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_barter_benefits_barter
  ON public.barter_benefits (barter_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_barter_benefits_type
  ON public.barter_benefits (organization_id, benefit_type);

ALTER TABLE public.barter_benefits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barter_benefits_org_members ON public.barter_benefits;
CREATE POLICY barter_benefits_org_members ON public.barter_benefits
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = barter_benefits.organization_id
      AND om.user_id = auth.uid()
      AND om.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = barter_benefits.organization_id
      AND om.user_id = auth.uid()
      AND om.is_active = true
  )
);

DROP POLICY IF EXISTS barter_benefits_influencer_read ON public.barter_benefits;
CREATE POLICY barter_benefits_influencer_read ON public.barter_benefits
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.barters b
    JOIN public.influencers i ON i.id = b.influencer_id
    WHERE b.id = barter_benefits.barter_id
      AND i.user_id = auth.uid()
  )
);

-- Convierte los canjes históricos en un beneficio fijo para conservar su valor.
INSERT INTO public.barter_benefits (
  organization_id, barter_id, benefit_type, description, fixed_value, currency, position
)
SELECT
  b.organization_id,
  b.id,
  'other'::public.barter_benefit_type,
  COALESCE(NULLIF(b.description, ''), b.item),
  COALESCE(b.estimated_value, 0),
  COALESCE(b.currency, 'CLP'),
  0
FROM public.barters b
WHERE NOT EXISTS (
  SELECT 1 FROM public.barter_benefits bb WHERE bb.barter_id = b.id
);
