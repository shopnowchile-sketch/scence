-- ============================================================================
-- Influencers — ubicación geográfica como fuente única de verdad
-- Fase 2A: vincula cada influencer a la comuna oficial de public.locations.
--
-- No elimina todavía country/city/commune: primero se migra y se cambia todo
-- el código consumidor. La eliminación será una fase posterior y separada.
-- ============================================================================

ALTER TABLE public.influencers
  ADD COLUMN IF NOT EXISTS location_id uuid;

ALTER TABLE public.influencers
  DROP CONSTRAINT IF EXISTS influencers_location_id_fkey;

ALTER TABLE public.influencers
  ADD CONSTRAINT influencers_location_id_fkey
  FOREIGN KEY (location_id)
  REFERENCES public.locations(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS influencers_location_id_idx
  ON public.influencers(location_id);

COMMENT ON COLUMN public.influencers.location_id IS
  'Comuna oficial de residencia/pertenencia de la influencer. Fuente única de verdad geográfica; apunta a locations.level=commune.';

-- Backfill conservador por nombre oficial normalizado.
-- locations contiene únicamente las 346 comunas oficiales de Chile.
-- No se modifican los textos legacy todavía.
UPDATE public.influencers i
SET location_id = l.id
FROM public.locations l
WHERE l.level = 'commune'
  AND l.is_active = true
  AND public.locations_norm(l.name) = public.locations_norm(i.commune)
  AND nullif(btrim(i.commune), '') IS NOT NULL
  AND i.location_id IS NULL;

-- Garantiza que location_id solo pueda apuntar a una comuna.
CREATE OR REPLACE FUNCTION public.validate_influencer_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_level public.locations.level%TYPE;
BEGIN
  IF NEW.location_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT level INTO v_level
  FROM public.locations
  WHERE id = NEW.location_id
    AND is_active = true;

  IF v_level IS NULL THEN
    RAISE EXCEPTION 'La ubicación seleccionada no existe o está inactiva'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_level <> 'commune' THEN
    RAISE EXCEPTION 'La ubicación de una influencer debe ser una comuna'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_influencer_location ON public.influencers;

CREATE TRIGGER trg_validate_influencer_location
BEFORE INSERT OR UPDATE OF location_id ON public.influencers
FOR EACH ROW
EXECUTE FUNCTION public.validate_influencer_location();
