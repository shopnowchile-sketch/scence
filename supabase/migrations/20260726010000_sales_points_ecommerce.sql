-- Puntos de venta físicos y e-commerce de una marca.
-- Un link se guarda en formato URL absoluto y se puede asignar a campañas.

ALTER TABLE public.brand_locations
  ADD COLUMN IF NOT EXISTS website_url text;

ALTER TABLE public.brand_locations
  DROP CONSTRAINT IF EXISTS brand_locations_location_type_check;

ALTER TABLE public.brand_locations
  ADD CONSTRAINT brand_locations_location_type_check
  CHECK (location_type IN ('store', 'online', 'event', 'restaurant', 'home', 'virtual', 'other'));

ALTER TABLE public.brand_locations
  DROP CONSTRAINT IF EXISTS brand_locations_website_url_check;

ALTER TABLE public.brand_locations
  ADD CONSTRAINT brand_locations_website_url_check
  CHECK (website_url IS NULL OR website_url ~* '^https?://');

CREATE INDEX IF NOT EXISTS idx_brand_locations_sales_points
  ON public.brand_locations (brand_id, location_type);
