-- SCENCE — Locations as single source of truth for physical campaign locations
-- Safe / schema-only phase. NO historical data is backfilled here.
-- Physical backfill is intentionally deferred until an audited, reversible mapping is approved.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS location_id uuid;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_location_id_fkey;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_location_id_fkey
  FOREIGN KEY (location_id)
  REFERENCES public.locations(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS campaigns_location_id_idx
  ON public.campaigns(location_id)
  WHERE location_id IS NOT NULL;

COMMENT ON COLUMN public.campaigns.location_id IS
  'Canonical physical Location. Required whenever a campaign has a physical location. Legacy address/metadata fields are compatibility only.';

-- Database guard: a campaign may only reference an active, non-private physical place.
-- This does not alter the geographic hierarchy or locations parent_id rules.
CREATE OR REPLACE FUNCTION public.validate_campaign_location_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level text;
  v_type text;
  v_active boolean;
  v_private boolean;
BEGIN
  IF NEW.location_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT level, type, is_active, is_private
    INTO v_level, v_type, v_active, v_private
  FROM public.locations
  WHERE id = NEW.location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La Location de la campaña no existe'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_level <> 'place' THEN
    RAISE EXCEPTION 'campaigns.location_id debe apuntar a una Location física (level=place)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'No se puede asignar una Location física inactiva a una campaña'
      USING ERRCODE = 'check_violation';
  END IF;

  IF coalesce(v_private, false) OR v_type = 'influencer_home' THEN
    RAISE EXCEPTION 'Las campañas no pueden utilizar Locations privadas de influencers'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_validate_location ON public.campaigns;
CREATE TRIGGER trg_campaigns_validate_location
BEFORE INSERT OR UPDATE OF location_id ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.validate_campaign_location_reference();

-- RLS: keep locations closed by default. Existing influencer-home policy remains.
-- Admins are platform super_admins, matching isPlatformAdmin() in the application.
DROP POLICY IF EXISTS locations_platform_admin_read ON public.locations;
CREATE POLICY locations_platform_admin_read
ON public.locations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.is_active = true
      AND om.role = 'super_admin'::public.user_role
  )
);

-- Brands may only read non-private commercial places that belong to, or are
-- actually used by, campaigns/events/bookings they are authorized to access.
DROP POLICY IF EXISTS locations_brand_activity_read ON public.locations;
CREATE POLICY locations_brand_activity_read
ON public.locations
FOR SELECT
TO authenticated
USING (
  coalesce(is_private, false) = false
  AND coalesce(type, '') <> 'influencer_home'
  AND (
    public.user_can_access_brand(brand_id)
    OR EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.location_id = locations.id
        AND (
          public.user_can_access_brand(c.brand_id)
          OR EXISTS (
            SELECT 1
            FROM public.campaign_brands cb
            WHERE cb.campaign_id = c.id
              AND public.user_can_access_brand(cb.brand_id)
          )
        )
    )
  )
);

-- No authenticated write policy is added: writes remain server-side through
-- the existing authorized API/service-role path.
