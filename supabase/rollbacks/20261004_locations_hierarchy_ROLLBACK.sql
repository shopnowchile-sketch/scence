-- ============================================================================
-- ROLLBACK — Locations Fase 1
-- Revierte, en orden inverso:
--   20261004230200_locations_drop_legacy_geo_columns (si se aplicó; vive en supabase/pending/)
--   20261004230100_locations_seed_chile
--   20261004230000_locations_hierarchy
-- Deja `locations` exactamente como estaba antes (mismas columnas, NOT NULL,
-- default y CHECK), conservando los places existentes.
--
-- PRECONDICIÓN: revertir antes el código (/api/locations + UI) a la versión
-- anterior. Si se crearon places nuevos con la Fase 1, se conservan; sus
-- city/region/country se reconstruyen desde la jerarquía.
-- OJO: el esquema anterior no tiene soft delete. Los places con is_active=false
-- vuelven a verse en la UI vieja; se listan con NOTICE antes de soltar is_active.
-- ============================================================================
BEGIN;

-- 0) Soltar la validación primero (los UPDATE de restauración no deben pasar por ella)
DROP TRIGGER IF EXISTS trg_locations_validate_hierarchy ON public.locations;

-- 1) Restaurar columnas legacy y sus valores
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS city    text,
  ADD COLUMN IF NOT EXISTS region  text,
  ADD COLUMN IF NOT EXISTS country text;

DO $$
BEGIN
  IF to_regclass('ops.locations_legacy_geo_20261004') IS NOT NULL THEN
    UPDATE public.locations l
    SET city = b.city, region = b.region, country = b.country
    FROM ops.locations_legacy_geo_20261004 b
    WHERE b.id = l.id;
  END IF;
END $$;

-- Places creados después: derivar desde la jerarquía antes de borrarla.
UPDATE public.locations pl
SET city    = coalesce(pl.city,    bc->>'commune'),
    region  = coalesce(pl.region,  bc->>'region'),
    country = coalesce(pl.country, bc->>'country')
FROM (
  SELECT p.id,
         (SELECT jsonb_object_agg(e->>'level', e->>'name')
          FROM jsonb_array_elements(public.location_breadcrumb(p.id)) e) AS bc
  FROM public.locations p WHERE p.level = 'place'
) x
WHERE x.id = pl.id;

-- 2) Quitar validaciones y funciones
DROP FUNCTION IF EXISTS public.locations_validate_hierarchy();
DROP FUNCTION IF EXISTS public.search_locations(text, boolean, integer);
DROP FUNCTION IF EXISTS public.location_breadcrumb(uuid);
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_place_fields_check;
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_level_check;
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_coords_check;
DROP INDEX IF EXISTS public.locations_geo_unique_name;
DROP INDEX IF EXISTS public.locations_level_idx;
DROP INDEX IF EXISTS public.locations_parent_idx;
DROP FUNCTION IF EXISTS public.locations_norm(text);

-- 3) Borrar catálogo geográfico (seed). Primero soltar referencias de places.
UPDATE public.locations SET parent_id = NULL WHERE level = 'place';
DELETE FROM public.locations WHERE level = 'commune';
DELETE FROM public.locations WHERE level = 'city';
DELETE FROM public.locations WHERE level = 'region';
DELETE FROM public.locations WHERE level = 'country';

-- 4) Restaurar forma original de la tabla
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, name FROM public.locations WHERE level = 'place' AND NOT is_active LOOP
    RAISE NOTICE 'Place desactivado que vuelve a quedar visible: % (%)', r.name, r.id;
  END LOOP;
END $$;
ALTER TABLE public.locations
  DROP COLUMN IF EXISTS parent_id,
  DROP COLUMN IF EXISTS level,
  DROP COLUMN IF EXISTS is_active;
UPDATE public.locations SET type = 'other' WHERE type IS NULL;
ALTER TABLE public.locations ALTER COLUMN type SET DEFAULT 'other';
ALTER TABLE public.locations ALTER COLUMN type SET NOT NULL;
ALTER TABLE public.locations ALTER COLUMN organization_id SET NOT NULL;

COMMIT;

-- Opcional, una vez verificado: DROP TABLE ops.locations_legacy_geo_20261004;
