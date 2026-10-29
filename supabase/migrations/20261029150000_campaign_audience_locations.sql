-- Segmentación geográfica de campañas: a qué zonas se muestra una campaña.
-- Cada fila apunta a un nodo GEOGRÁFICO de public.locations (country, region,
-- city o commune); no se duplica ningún dato de ubicación. Sin filas = sin
-- restricción (comportamiento actual de todas las campañas existentes).
-- LATAM no es un nodo: la UI lo expande a los países LATAM del catálogo.
--
-- Independiente de campaign_locations (dirección del evento, privada hasta aceptar).
-- Acceso: igual que campaign_locations — RLS sin políticas, sin privilegios para
-- anon/authenticated; todo pasa por /api/campaigns/[id]/audience con service role.
-- Rollback: supabase/rollbacks/20261029150000_campaign_audience_locations_ROLLBACK.sql

CREATE TABLE public.campaign_audience_locations (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, location_id)
);

CREATE INDEX campaign_audience_locations_location_idx
  ON public.campaign_audience_locations (location_id);

ALTER TABLE public.campaign_audience_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campaign_audience_locations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.campaign_audience_locations TO service_role;

CREATE OR REPLACE FUNCTION public.campaign_audience_locations_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_loc public.locations%ROWTYPE;
BEGIN
  SELECT * INTO v_loc FROM public.locations WHERE id = NEW.location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La ubicación no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_loc.level NOT IN ('country', 'region', 'city', 'commune') THEN
    RAISE EXCEPTION 'La segmentación debe ser geográfica (país, región, ciudad o comuna), no %', v_loc.level
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_loc.is_active THEN
    RAISE EXCEPTION 'La ubicación "%" está desactivada', v_loc.name USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_campaign_audience_locations_validate
  BEFORE INSERT OR UPDATE OF location_id ON public.campaign_audience_locations
  FOR EACH ROW EXECUTE FUNCTION public.campaign_audience_locations_validate();

REVOKE EXECUTE ON FUNCTION public.campaign_audience_locations_validate() FROM PUBLIC, anon, authenticated;
