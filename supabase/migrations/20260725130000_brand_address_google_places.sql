-- Dirección legal normalizada desde Google Maps para marcas y reportes territoriales.
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS address_place_id TEXT,
  ADD COLUMN IF NOT EXISTS address_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS address_lng NUMERIC(10,7);

CREATE INDEX IF NOT EXISTS idx_brands_address_country_city
  ON public.brands (address_country, address_city);
