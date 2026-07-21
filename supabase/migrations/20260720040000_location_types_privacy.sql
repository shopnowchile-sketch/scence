-- Tipos de lugares para acciones y protección especial de domicilios.

ALTER TABLE public.brand_locations
  ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS is_sensitive boolean NOT NULL DEFAULT false;
ALTER TABLE public.brand_locations
  DROP CONSTRAINT IF EXISTS brand_locations_location_type_check;
ALTER TABLE public.brand_locations
  ADD CONSTRAINT brand_locations_location_type_check
  CHECK (location_type IN ('store', 'event', 'restaurant', 'home', 'virtual', 'other'));
UPDATE public.brand_locations
SET is_sensitive = true, is_public = false
WHERE location_type = 'home';
CREATE OR REPLACE FUNCTION public.protect_sensitive_brand_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.location_type = 'home' THEN
    NEW.is_sensitive := true;
    NEW.is_public := false;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_sensitive_brand_location ON public.brand_locations;
CREATE TRIGGER trg_protect_sensitive_brand_location
BEFORE INSERT OR UPDATE ON public.brand_locations
FOR EACH ROW EXECUTE FUNCTION public.protect_sensitive_brand_location();
CREATE INDEX IF NOT EXISTS idx_brand_locations_type
  ON public.brand_locations (brand_id, location_type);
