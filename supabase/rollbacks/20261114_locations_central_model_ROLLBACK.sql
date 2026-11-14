-- Rollback de 20261114120000_locations_central_model (propuesta). Solo válido si las tablas/columnas aún no tienen datos que conservar.
DROP INDEX IF EXISTS public.crm_leads_location_idx;
ALTER TABLE public.crm_leads DROP COLUMN IF EXISTS location_id;
DROP INDEX IF EXISTS public.barter_benefits_shipping_location_idx;
ALTER TABLE public.barter_benefits DROP COLUMN IF EXISTS shipping_location_id;
DROP TABLE IF EXISTS public.influencer_region_availability;
DROP FUNCTION IF EXISTS public.influencer_region_availability_check();
DROP INDEX IF EXISTS public.locations_one_primary_per_influencer;
ALTER TABLE public.locations DROP COLUMN IF EXISTS is_primary;
DROP TABLE IF EXISTS public.location_brand_shares;
