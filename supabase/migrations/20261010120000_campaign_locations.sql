-- Direcciones de campaña: una campaña puede tener una o varias direcciones,
-- con una principal. La dirección es SIEMPRE una referencia a public.locations
-- (catálogo canónico, level = 'place'); aquí no se duplica ningún dato de lugar.
--
-- Aditiva: no toca campaigns, bookings, locations ni brand_locations. El texto
-- histórico (campaigns.metadata.*, bookings.location*) se conserva intacto y
-- sigue siendo el respaldo de lectura hasta que cada campaña se resuelva.
--
-- Acceso: igual que campaign_brand_collaborations — RLS habilitado y sin
-- privilegios para anon/authenticated. Todo pasa por /api/campaigns/[id]/locations
-- con service role, que valida admin de plataforma o marca dueña de la campaña.
-- La privacidad previa a la aceptación de la influencer (dirección exacta
-- oculta) también se aplica en esas rutas, no en el cliente.

CREATE TABLE public.campaign_locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  -- RESTRICT: un lugar en uso no se borra; se desactiva (locations.is_active).
  location_id  UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- Indicaciones de llegada propias de esta dirección en esta campaña.
  instructions TEXT CHECK (char_length(instructions) <= 500),
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sin direcciones repetidas por campaña, y como máximo una principal.
CREATE UNIQUE INDEX campaign_locations_campaign_location_key
  ON public.campaign_locations (campaign_id, location_id);
CREATE UNIQUE INDEX campaign_locations_one_primary_key
  ON public.campaign_locations (campaign_id) WHERE is_primary;
CREATE INDEX campaign_locations_location_idx
  ON public.campaign_locations (location_id);

ALTER TABLE public.campaign_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campaign_locations FROM PUBLIC, anon, authenticated;

-- Validación de integridad (misma línea que locations_validate_hierarchy).
CREATE OR REPLACE FUNCTION public.campaign_locations_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_loc      public.locations%ROWTYPE;
  v_campaign public.campaigns%ROWTYPE;
BEGIN
  SELECT * INTO v_loc FROM public.locations WHERE id = NEW.location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El lugar no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_loc.level <> 'place' THEN
    RAISE EXCEPTION 'La dirección de una campaña debe ser un lugar físico (place), no %', v_loc.level
      USING ERRCODE = 'check_violation';
  END IF;

  -- Solo validar activo / dueño al insertar o al cambiar de lugar; así editar
  -- indicaciones o la principal no falla si el lugar se desactivó después.
  IF TG_OP = 'INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    IF NOT v_loc.is_active THEN
      RAISE EXCEPTION 'El lugar "%" está desactivado', v_loc.name USING ERRCODE = 'check_violation';
    END IF;
    -- Domicilios de influencers jamás son dirección de campaña.
    IF v_loc.type = 'influencer_home' OR v_loc.owner_influencer_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un domicilio de influencer no puede ser dirección de campaña'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Un lugar que pertenece a una marca solo sirve a campañas de esa marca.
    IF v_loc.brand_id IS NOT NULL THEN
      SELECT * INTO v_campaign FROM public.campaigns WHERE id = NEW.campaign_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La campaña no existe' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF v_loc.brand_id IS DISTINCT FROM v_campaign.brand_id
         AND v_loc.brand_id IS DISTINCT FROM v_campaign.created_by_brand_id THEN
        RAISE EXCEPTION 'El lugar "%" pertenece a otra marca', v_loc.name USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- La primera dirección de una campaña es la principal.
  IF TG_OP = 'INSERT' AND NOT NEW.is_primary
     AND NOT EXISTS (SELECT 1 FROM public.campaign_locations WHERE campaign_id = NEW.campaign_id) THEN
    NEW.is_primary := true;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_campaign_locations_validate
  BEFORE INSERT OR UPDATE OF location_id, campaign_id ON public.campaign_locations
  FOR EACH ROW EXECUTE FUNCTION public.campaign_locations_validate();

-- Si se quita la principal y quedan otras, la más antigua pasa a ser principal.
CREATE OR REPLACE FUNCTION public.campaign_locations_promote_primary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_primary THEN
    UPDATE public.campaign_locations
       SET is_primary = true
     WHERE id = (
       SELECT id FROM public.campaign_locations
        WHERE campaign_id = OLD.campaign_id
        ORDER BY sort_order, created_at, id
        LIMIT 1
     );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_campaign_locations_promote_primary
  AFTER DELETE ON public.campaign_locations
  FOR EACH ROW EXECUTE FUNCTION public.campaign_locations_promote_primary();

-- Cambio atómico de principal (dos UPDATE en una sola transacción: el índice
-- parcial único impide que queden dos principales).
CREATE OR REPLACE FUNCTION public.campaign_locations_set_primary(p_campaign_id UUID, p_link_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.campaign_locations WHERE id = p_link_id AND campaign_id = p_campaign_id) THEN
    RAISE EXCEPTION 'La dirección no pertenece a esta campaña' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE public.campaign_locations SET is_primary = false
   WHERE campaign_id = p_campaign_id AND is_primary AND id <> p_link_id;
  UPDATE public.campaign_locations SET is_primary = true
   WHERE id = p_link_id AND NOT is_primary;
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_locations_set_primary(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_locations_set_primary(UUID, UUID) TO service_role;
