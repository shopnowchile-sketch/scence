-- Influencers: complete location source-of-truth migration (international-safe)
--
-- Non-destructive. Legacy country/city/commune stay until all unresolved data
-- and all application consumers have been audited.

CREATE OR REPLACE FUNCTION public.validate_influencer_location()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_level public.locations.level%TYPE;
BEGIN
  IF NEW.location_id IS NULL THEN RETURN NEW; END IF;

  SELECT level INTO v_level
  FROM public.locations
  WHERE id = NEW.location_id AND is_active = true;

  IF v_level IS NULL THEN
    RAISE EXCEPTION 'La ubicación seleccionada no existe o está inactiva'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_level = 'place' THEN
    RAISE EXCEPTION 'La ubicación de una influencer no puede ser un lugar físico'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Canonical country names for values explicitly present in legacy data.
WITH country_map(legacy_value, canonical_name) AS (
  VALUES
    ('cl', 'Chile'),
    ('chile', 'Chile'),
    ('chili', 'Chile'),
    ('chie', 'Chile'),
    ('argentina', 'Argentina'),
    ('colombia', 'Colombia'),
    ('españa', 'España'),
    ('paraguay', 'Paraguay'),
    ('méxico', 'México')
)
INSERT INTO public.locations (
  organization_id, name, type, address, city, region, country,
  is_private, notes, level, is_active
)
SELECT
  NULL, cm.canonical_name, NULL, NULL, NULL, NULL, NULL,
  false, 'Catálogo geográfico global — creado desde migración de influencers',
  'country', true
FROM country_map cm
WHERE EXISTS (
  SELECT 1 FROM public.influencers i
  WHERE i.location_id IS NULL
    AND public.locations_norm(trim(i.country)) = public.locations_norm(cm.legacy_value)
)
AND NOT EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.level = 'country'
    AND public.locations_norm(l.name) = public.locations_norm(cm.canonical_name)
);

-- 1) High-confidence Chile migration.
-- The legacy city is used only when it exactly matches one active official
-- commune in Chile. We never infer a commune from free-form addresses here.
WITH chile AS (
  SELECT id
  FROM public.locations
  WHERE level = 'country'
    AND public.locations_norm(name) = public.locations_norm('Chile')
),
candidate AS (
  SELECT
    i.id AS influencer_id,
    min(l.id) AS location_id
  FROM public.influencers i
  JOIN chile c ON true
  JOIN public.locations l
    ON l.level = 'commune'
   AND l.is_active = true
   AND public.locations_norm(l.name) = public.locations_norm(i.city)
  JOIN public.locations parent_region ON parent_region.id = l.parent_id
  WHERE i.location_id IS NULL
    AND public.locations_norm(trim(i.country)) IN (
      public.locations_norm('cl'),
      public.locations_norm('chile'),
      public.locations_norm('chili'),
      public.locations_norm('chie')
    )
    AND parent_region.parent_id = c.id
    AND nullif(trim(i.city), '') IS NOT NULL
  GROUP BY i.id
  HAVING count(*) = 1
)
UPDATE public.influencers i
SET location_id = candidate.location_id
FROM candidate
WHERE i.id = candidate.influencer_id
  AND i.location_id IS NULL;

-- 2) Explicit country fallback.
-- This preserves real international/Chile data even when city is missing or
-- ambiguous. It is deliberately country-level rather than guessing a city.
WITH country_map(legacy_value, canonical_name) AS (
  VALUES
    ('cl', 'Chile'),
    ('chile', 'Chile'),
    ('chili', 'Chile'),
    ('chie', 'Chile'),
    ('argentina', 'Argentina'),
    ('colombia', 'Colombia'),
    ('españa', 'España'),
    ('paraguay', 'Paraguay'),
    ('méxico', 'México')
)
UPDATE public.influencers i
SET location_id = l.id
FROM country_map cm
JOIN public.locations l
  ON l.level = 'country'
 AND public.locations_norm(l.name) = public.locations_norm(cm.canonical_name)
WHERE i.location_id IS NULL
  AND public.locations_norm(trim(i.country)) = public.locations_norm(cm.legacy_value);

COMMENT ON COLUMN public.influencers.location_id IS
  'Fuente oficial de ubicación geográfica de la influencer. Puede apuntar a country, region, city o commune; nunca a place. Los campos country/city/commune legacy permanecen solo durante la transición.';
