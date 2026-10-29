-- Reversa de 20261029150000_campaign_audience_locations.sql
-- Las campañas vuelven a verse sin restricción geográfica.
DROP TABLE IF EXISTS public.campaign_audience_locations;
DROP FUNCTION IF EXISTS public.campaign_audience_locations_validate();
