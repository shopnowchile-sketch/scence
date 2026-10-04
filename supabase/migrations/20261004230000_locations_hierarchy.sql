-- ============================================================================
-- Locations — Fase 1: jerarquía geográfica sobre la tabla EXISTENTE
-- Diseño aprobado: audits/2026-10-04/09_LOCATIONS_DESIGN.md (+ ajustes de Pri)
--
-- `public.locations` ya existía en producción sin migración versionada
-- (creada fuera del repo). Este archivo:
--   0) la documenta tal como está hoy (idempotente: no-op en producción);
--   1) agrega parent_id, level, is_active;
--   2) permite organization_id / type NULL solo para nodos geográficos;
--   3) valida la jerarquía EN LA BASE (trigger), no solo en la app.
--
-- Jerarquía:  country → region → [city] → commune → place
--   - city es OPCIONAL: commune.parent puede ser region o city.
--   - place = lugar físico con dueño (org/brand/influencer) y privacidad.
--   - country..commune = catálogo global (organization_id NULL).
--
-- No destructiva: city/region/country se eliminan en un paso aparte
-- (supabase/pending/20261004230200_locations_drop_legacy_geo_columns.sql),
-- que se mueve a migrations/ SOLO después de desplegar el código nuevo.
-- Rollback: supabase/rollbacks/20261004_locations_hierarchy_ROLLBACK.sql
-- ============================================================================

-- 0) Documentar la tabla existente (no-op si ya existe) ----------------------
CREATE TABLE IF NOT EXISTS public.locations (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                text NOT NULL,
  type                text NOT NULL DEFAULT 'other',
  address             text,
  city                text,
  region              text,
  country             text,
  lat                 numeric,
  lng                 numeric,
  is_private          boolean NOT NULL DEFAULT false,
  owner_influencer_id uuid REFERENCES public.influencers(id) ON DELETE SET NULL,
  brand_id            uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  notes               text,
  created_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_type_check CHECK (type = ANY (ARRAY['brand_venue','store','showroom','event','influencer_home','other']))
);
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- 1) Columnas nuevas -----------------------------------------------------------
-- Todas las filas existentes son lugares físicos → level='place'.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS level     text NOT NULL DEFAULT 'place',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.locations ALTER COLUMN level DROP DEFAULT;

COMMENT ON COLUMN public.locations.parent_id IS 'Padre en la jerarquía. NULL solo para country (y places legacy sin comuna asignada).';
COMMENT ON COLUMN public.locations.level     IS 'Nivel jerárquico: country | region | city (opcional) | commune | place.';
COMMENT ON COLUMN public.locations.type      IS 'Categoría del lugar físico (solo level=place). NULL en niveles geográficos.';
COMMENT ON COLUMN public.locations.is_active IS 'Soft delete. No se puede desactivar un nodo con hijos activos.';
COMMENT ON COLUMN public.locations.organization_id IS 'Org dueña del place. NULL en el catálogo geográfico global.';

-- 2) Nullability: geografía no tiene dueño ni categoría --------------------------
ALTER TABLE public.locations ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE public.locations ALTER COLUMN type DROP NOT NULL;
ALTER TABLE public.locations ALTER COLUMN type DROP DEFAULT;

-- 3) Constraints declarativas (todas las filas actuales son places válidos) -----
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_level_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_level_check
  CHECK (level IN ('country', 'region', 'city', 'commune', 'place'));

-- place: dueño de tenant + categoría obligatorios.
-- geografía: sin dueño, sin categoría, sin dirección, sin coordenadas, sin privacidad.
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_place_fields_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_place_fields_check CHECK (
  CASE WHEN level = 'place' THEN
    organization_id IS NOT NULL AND type IS NOT NULL
  ELSE
    organization_id IS NULL AND type IS NULL AND address IS NULL
    AND lat IS NULL AND lng IS NULL AND brand_id IS NULL
    AND owner_influencer_id IS NULL AND is_private = false
  END
);

ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_coords_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_coords_check CHECK (
  (lat IS NULL OR lat BETWEEN -90 AND 90) AND (lng IS NULL OR lng BETWEEN -180 AND 180)
);

-- 4) Normalización única (búsqueda + unicidad) -----------------------------------
CREATE OR REPLACE FUNCTION public.locations_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(translate(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')),
                         'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
$$;

-- 5) Índices -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS locations_parent_idx ON public.locations (parent_id);
CREATE INDEX IF NOT EXISTS locations_level_idx  ON public.locations (level);
-- Un nombre por nivel bajo el mismo padre (geografía). Países: padre NULL → coalesce.
CREATE UNIQUE INDEX IF NOT EXISTS locations_geo_unique_name
  ON public.locations (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), level, public.locations_norm(name))
  WHERE level <> 'place';

-- 6) Validación de jerarquía (fuente de verdad: la base) ------------------------
CREATE OR REPLACE FUNCTION public.locations_validate_hierarchy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_parent    public.locations%ROWTYPE;
  v_region_id uuid;
BEGIN
  -- Domicilio de influencer siempre privado (misma regla que brand_locations).
  IF NEW.type = 'influencer_home' THEN NEW.is_private := true; END IF;

  -- UPDATE que no toca la estructura (p. ej. ON DELETE SET NULL de brand_id /
  -- owner_influencer_id / created_by, o editar notas): no revalidar. Así borrar
  -- una marca o un usuario nunca queda bloqueado por un place legacy sin comuna.
  IF TG_OP = 'UPDATE'
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.level     IS NOT DISTINCT FROM OLD.level
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
     AND NEW.name      IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;

  NEW.name := btrim(NEW.name);
  IF NEW.name = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio' USING ERRCODE = 'check_violation';
  END IF;

  -- Padre permitido por nivel. city es opcional entre region y commune.
  IF NEW.level = 'country' THEN
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un país no puede tener padre' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.parent_id IS NULL THEN
      RAISE EXCEPTION '% requiere un padre (%)', NEW.level,
        CASE NEW.level WHEN 'region' THEN 'país' WHEN 'city' THEN 'región'
                       WHEN 'commune' THEN 'región o ciudad' ELSE 'comuna' END
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_parent FROM public.locations WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El padre no existe' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NOT (
         (NEW.level = 'region'  AND v_parent.level = 'country')
      OR (NEW.level = 'city'    AND v_parent.level = 'region')
      OR (NEW.level = 'commune' AND v_parent.level IN ('region', 'city'))
      OR (NEW.level = 'place'   AND v_parent.level = 'commune')
    ) THEN
      RAISE EXCEPTION 'Jerarquía inválida: % no puede depender de %', NEW.level, v_parent.level
        USING ERRCODE = 'check_violation';
    END IF;
    -- Un hijo activo no puede colgar de un padre inactivo.
    IF NEW.is_active AND NOT v_parent.is_active THEN
      RAISE EXCEPTION 'No se puede activar "%" bajo un padre inactivo (%)', NEW.name, v_parent.name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Una comuna existe una sola vez por región (cuelgue de la región o de una ciudad).
  IF NEW.level = 'commune' THEN
    v_region_id := CASE v_parent.level WHEN 'region' THEN v_parent.id ELSE v_parent.parent_id END;
    -- Serializa altas/movimientos de comunas por región (evita duplicados concurrentes).
    PERFORM pg_advisory_xact_lock(hashtext('locations_commune:' || v_region_id::text));
    IF EXISTS (
      SELECT 1
      FROM public.locations c
      JOIN public.locations cp ON cp.id = c.parent_id
      WHERE c.level = 'commune'
        AND c.id <> NEW.id
        AND public.locations_norm(c.name) = public.locations_norm(NEW.name)
        AND (CASE cp.level WHEN 'region' THEN cp.id ELSE cp.parent_id END) = v_region_id
    ) THEN
      RAISE EXCEPTION 'La comuna "%" ya existe en esta región', NEW.name USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Mover una ciudad a otra región: sus comunas no pueden duplicar comunas de la región destino.
  IF NEW.level = 'city' AND TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM pg_advisory_xact_lock(hashtext('locations_commune:' || NEW.parent_id::text));
    IF EXISTS (
      SELECT 1
      FROM public.locations mine
      JOIN public.locations c  ON c.level = 'commune' AND c.parent_id <> NEW.id
                              AND public.locations_norm(c.name) = public.locations_norm(mine.name)
      JOIN public.locations cp ON cp.id = c.parent_id
      WHERE mine.parent_id = NEW.id AND mine.level = 'commune'
        AND (CASE cp.level WHEN 'region' THEN cp.id ELSE cp.parent_id END) = NEW.parent_id
    ) THEN
      RAISE EXCEPTION 'No se puede mover "%": alguna de sus comunas ya existe en la región destino', NEW.name
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- El nivel es fijo si el nodo ya tiene hijos.
    IF NEW.level <> OLD.level AND EXISTS (SELECT 1 FROM public.locations WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'No se puede cambiar el nivel de "%": tiene hijos', NEW.name USING ERRCODE = 'check_violation';
    END IF;
    -- Soft delete: bloquear desactivar con hijos activos.
    IF OLD.is_active AND NOT NEW.is_active
       AND EXISTS (SELECT 1 FROM public.locations WHERE parent_id = NEW.id AND is_active) THEN
      RAISE EXCEPTION 'No se puede desactivar "%": tiene hijos activos', NEW.name USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_locations_validate_hierarchy ON public.locations;
CREATE TRIGGER trg_locations_validate_hierarchy
BEFORE INSERT OR UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.locations_validate_hierarchy();

-- 7) Breadcrumb y búsqueda (derivados; no se guarda path) -----------------------
-- Raíz → nodo: [{id, name, level}, ...]. Máx. 5 niveles.
CREATE OR REPLACE FUNCTION public.location_breadcrumb(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, name, level, 0 AS depth FROM public.locations WHERE id = p_id
    UNION ALL
    SELECT l.id, l.parent_id, l.name, l.level, up.depth + 1
    FROM public.locations l JOIN up ON l.id = up.parent_id
    WHERE up.depth < 6
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'level', level) ORDER BY depth DESC), '[]'::jsonb)
  FROM up
$$;

-- Búsqueda sin tildes ni mayúsculas, con breadcrumb. Solo admin (service role).
CREATE OR REPLACE FUNCTION public.search_locations(
  p_query            text,
  p_include_inactive boolean DEFAULT false,
  p_limit            integer DEFAULT 30
)
RETURNS TABLE (
  id uuid, parent_id uuid, level text, type text, name text, address text,
  is_active boolean, is_private boolean, breadcrumb jsonb
) LANGUAGE sql STABLE AS $$
  SELECT l.id, l.parent_id, l.level, l.type, l.name, l.address, l.is_active, l.is_private,
         public.location_breadcrumb(l.id)
  FROM public.locations l
  WHERE public.locations_norm(l.name) LIKE '%' || public.locations_norm(p_query) || '%'
    AND (p_include_inactive OR l.is_active)
  ORDER BY
    (public.locations_norm(l.name) = public.locations_norm(p_query)) DESC,
    array_position(ARRAY['country','region','city','commune','place'], l.level),
    l.name
  LIMIT least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- Funciones solo para el backend (service role). Nada nuevo expuesto a anon/authenticated.
REVOKE ALL ON FUNCTION public.location_breadcrumb(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_locations(text, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.location_breadcrumb(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_locations(text, boolean, integer) TO service_role;

-- RLS: sin cambios. La única policy existente
-- (locations_influencer_read_own_home, SELECT por owner_influencer_id) no
-- depende de organization_id. Sin policies para el resto → anon/authenticated
-- siguen sin acceso; la protección real es la ruta (/api/locations, solo admin plataforma).
