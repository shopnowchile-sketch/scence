-- Seguimiento simple por beneficio para cada influencer.
-- Mantiene el estado global anterior para compatibilidad con datos históricos.
ALTER TABLE public.barters
  ADD COLUMN IF NOT EXISTS benefit_tracking jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.barters
  DROP CONSTRAINT IF EXISTS barters_benefit_tracking_array_check;

ALTER TABLE public.barters
  ADD CONSTRAINT barters_benefit_tracking_array_check
  CHECK (jsonb_typeof(benefit_tracking) = 'array');

COMMENT ON COLUMN public.barters.benefit_tracking IS
  'Estado y observación de cada beneficio de campaña por influencer.';
