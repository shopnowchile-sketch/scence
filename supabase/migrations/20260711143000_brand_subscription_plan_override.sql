-- Plan interno individual por marca.
-- No modifica Billing, facturas, pagos ni suscripciones financieras.
-- NULL significa: heredar suscripción/plan de la organización.

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS subscription_plan_override TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'brands_subscription_plan_override_check'
      AND conrelid = 'public.brands'::regclass
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_subscription_plan_override_check
      CHECK (
        subscription_plan_override IS NULL
        OR subscription_plan_override IN ('basic', 'growth', 'pro')
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.brands.subscription_plan_override IS
  'Override manual del plan interno de la marca: basic, growth, pro o NULL para heredar.';
