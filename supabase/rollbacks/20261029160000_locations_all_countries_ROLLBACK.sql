-- Reversa: quita solo los países agregados por 20261029160000 que no estén en uso
-- (sin hijos, sin influencers ni campañas que los referencien). Los 10 países originales se conservan.
DELETE FROM public.locations l
WHERE l.level = 'country'
  AND l.created_at >= timestamptz '2026-10-29'
  AND NOT EXISTS (SELECT 1 FROM public.locations c WHERE c.parent_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.influencers i WHERE i.location_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.campaign_audience_locations a WHERE a.location_id = l.id);
