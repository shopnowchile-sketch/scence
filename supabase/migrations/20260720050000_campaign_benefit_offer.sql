-- Oferta estándar de beneficios visible para todas las influencers de la campaña.
-- El seguimiento individual no puede cambiar estas condiciones.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS campaign_benefits jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_campaign_benefits_array_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_campaign_benefits_array_check
  CHECK (jsonb_typeof(campaign_benefits) = 'array');
COMMENT ON COLUMN public.campaigns.campaign_benefits IS
  'Beneficios estándar de la campaña: tipo, descripción, cantidad, valor y condición de activación.';
