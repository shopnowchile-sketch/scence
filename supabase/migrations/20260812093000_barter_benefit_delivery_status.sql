-- Estado y entrega viven en cada beneficio, no en la posición de un JSON.
DO $$ BEGIN
  CREATE TYPE public.barter_delivery_method AS ENUM ('event', 'store_pickup', 'shipping', 'digital', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE public.barter_benefit_status AS ENUM ('pending', 'ready', 'delivered', 'completed', 'problem', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.barter_benefits
  ADD COLUMN IF NOT EXISTS delivery_method public.barter_delivery_method NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status public.barter_benefit_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_note text;

CREATE INDEX IF NOT EXISTS idx_barter_benefits_status
  ON public.barter_benefits (barter_id, status, position);
