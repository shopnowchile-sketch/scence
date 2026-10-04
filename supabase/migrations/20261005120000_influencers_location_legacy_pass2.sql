-- Pass 2: recover only high-confidence legacy geography.
-- Never invent a city from ambiguous free text.
-- Legacy columns remain for unresolved records.

-- Exact country tokens that are unambiguous.
WITH country_map(legacy_value, canonical_name) AS (
  VALUES
    ('argentina','Argentina'),
    ('colombia','Colombia'),
    ('españa','España'),
    ('paraguay','Paraguay'),
    ('méxico','México')
)
UPDATE public.influencers i
SET location_id = l.id
FROM country_map cm
JOIN public.locations l
  ON l.level = 'country'
 AND public.locations_norm(l.name) = public.locations_norm(cm.canonical_name)
WHERE i.location_id IS NULL
  AND (
    public.locations_norm(trim(i.country)) = public.locations_norm(cm.legacy_value)
    OR public.locations_norm(trim(i.commune)) = public.locations_norm(cm.legacy_value)
  );

-- Exact Chile commune names from city/commune when country is blank.
-- This is safe because the match is against the official Chile commune catalog.
WITH chile AS (
  SELECT id FROM public.locations
  WHERE level='country' AND public.locations_norm(name)=public.locations_norm('Chile')
),
candidate AS (
  SELECT i.id influencer_id, (array_agg(l.id))[1] location_id
  FROM public.influencers i
  JOIN chile c ON true
  JOIN public.locations l
    ON l.level='commune' AND l.is_active=true
   AND (
     public.locations_norm(l.name)=public.locations_norm(i.city)
     OR public.locations_norm(l.name)=public.locations_norm(i.commune)
   )
  JOIN public.locations parent_region ON parent_region.id=l.parent_id
  WHERE i.location_id IS NULL
    AND nullif(trim(coalesce(i.country,'')),'') IS NULL
    AND (nullif(trim(i.city),'') IS NOT NULL OR nullif(trim(i.commune),'') IS NOT NULL)
    AND parent_region.parent_id=c.id
  GROUP BY i.id
  HAVING count(*)=1
)
UPDATE public.influencers i
SET location_id=candidate.location_id
FROM candidate
WHERE i.id=candidate.influencer_id AND i.location_id IS NULL;

-- Explicit Chile in free text, only when it also contains an exact official
-- commune/city token.
WITH chile AS (
  SELECT id FROM public.locations
  WHERE level='country' AND public.locations_norm(name)=public.locations_norm('Chile')
),
candidate AS (
  SELECT i.id influencer_id, (array_agg(l.id))[1] location_id
  FROM public.influencers i
  JOIN chile c ON true
  JOIN public.locations l
    ON l.level='commune' AND l.is_active=true
   AND public.locations_norm(l.name)=public.locations_norm(trim(i.city))
  JOIN public.locations parent_region ON parent_region.id=l.parent_id
  WHERE i.location_id IS NULL
    AND public.locations_norm(trim(i.city)) IN (
      public.locations_norm('Rancagua'),
      public.locations_norm('Santiago'),
      public.locations_norm('Viña del Mar'),
      public.locations_norm('Villa Alemana')
    )
    AND parent_region.parent_id=c.id
  GROUP BY i.id
  HAVING count(*)=1
)
UPDATE public.influencers i
SET location_id=candidate.location_id
FROM candidate
WHERE i.id=candidate.influencer_id AND i.location_id IS NULL;

-- Unambiguous country-only tokens in the legacy commune field.
WITH token_map(token, canonical_name) AS (
  VALUES
    ('venezuela','Venezuela'),
    ('brasil','Brasil')
)
INSERT INTO public.locations (
  organization_id,name,type,address,city,region,country,is_private,notes,level,is_active
SELECT NULL, tm.canonical_name,NULL,NULL,NULL,NULL,NULL,false,
       'Catálogo geográfico global — recuperado desde legacy de influencers',
       'country',true
FROM token_map tm
WHERE EXISTS (
  SELECT 1 FROM public.influencers i
  WHERE i.location_id IS NULL
    AND public.locations_norm(trim(i.commune))=public.locations_norm(tm.token)
)
AND NOT EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.level='country' AND public.locations_norm(l.name)=public.locations_norm(tm.canonical_name)
);

WITH token_map(token, canonical_name) AS (
  VALUES
    ('venezuela','Venezuela'),
    ('brasil','Brasil')
)
UPDATE public.influencers i
SET location_id=l.id
FROM token_map tm
JOIN public.locations l
  ON l.level='country'
 AND public.locations_norm(l.name)=public.locations_norm(tm.canonical_name)
WHERE i.location_id IS NULL
  AND public.locations_norm(trim(i.commune))=public.locations_norm(tm.token);

COMMENT ON COLUMN public.influencers.location_id IS
'Fuente oficial de ubicación geográfica. Legacy solo permanece para migración/auditoría de datos no resueltos.';