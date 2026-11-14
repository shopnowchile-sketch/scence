-- ============================================================================
-- Locations — modelo central (PROPUESTA, NO APLICADA). Solo aditiva e idempotente.
-- 1) Lugares compartidos entre marcas autorizadas (sin duplicar el place).
-- 2) Dirección principal de envío por influencer (varios influencer_home, uno principal).
-- 3) Disponibilidad regional presencial (separada de residencia y de direcciones).
-- 4) Dirección de envío congelada por beneficio/canje.
-- 5) Segmentación geográfica del CRM con el catálogo existente.
-- Sin backfill, sin DROP, sin cambios en políticas existentes.
-- Rollback: supabase/rollbacks/20261114_locations_central_model_ROLLBACK.sql
-- ============================================================================

-- 1) Compartir un place con otras marcas. Solo da uso del lugar en campañas;
--    no concede acceso a campañas, contactos ni datos privados de la marca dueña.
CREATE TABLE IF NOT EXISTS public.location_brand_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL REFERENCES public.brands(id)    ON DELETE CASCADE,
  granted_by  uuid, -- sin FK: profiles.id (PROD) vs profiles.user_id (DEV) difieren hasta la fase de identidad
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, brand_id)
);
ALTER TABLE public.location_brand_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.location_brand_shares FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.location_brand_shares TO service_role;

-- 2) Dirección principal de envío (una activa por influencer).
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS locations_one_primary_per_influencer
  ON public.locations (owner_influencer_id)
  WHERE is_primary AND is_active AND owner_influencer_id IS NOT NULL;

-- 3) Disponibilidad regional presencial (nodos level='region').
CREATE TABLE IF NOT EXISTS public.influencer_region_availability (
  influencer_id uuid NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  region_id     uuid NOT NULL REFERENCES public.locations(id)   ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (influencer_id, region_id)
);
CREATE OR REPLACE FUNCTION public.influencer_region_availability_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = NEW.region_id AND level = 'region') THEN
    RAISE EXCEPTION 'region_id debe ser una región' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_influencer_region_availability_check ON public.influencer_region_availability;
CREATE TRIGGER trg_influencer_region_availability_check
  BEFORE INSERT OR UPDATE ON public.influencer_region_availability
  FOR EACH ROW EXECUTE FUNCTION public.influencer_region_availability_check();
ALTER TABLE public.influencer_region_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.influencer_region_availability FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.influencer_region_availability TO service_role;

-- 4) Dirección elegida para un envío concreto; cambiar la principal no lo altera.
--    RESTRICT: un domicilio usado en un despacho se desactiva, no se borra.
ALTER TABLE public.barter_benefits
  ADD COLUMN IF NOT EXISTS shipping_location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS barter_benefits_shipping_location_idx
  ON public.barter_benefits (shipping_location_id) WHERE shipping_location_id IS NOT NULL;

-- 5) CRM: vínculo opcional al catálogo (país/región/ciudad/comuna). Texto original intacto.
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS crm_leads_location_idx
  ON public.crm_leads (location_id) WHERE location_id IS NOT NULL;
