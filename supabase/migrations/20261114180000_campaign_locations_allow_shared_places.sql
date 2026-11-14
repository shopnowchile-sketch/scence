-- PROPUESTA (NO APLICADA, NO COMMITEADA). Cambia el trigger campaign_locations_validate (trigger = Regla Cero).
-- Problema hallado en pruebas técnicas DEV: el trigger rechaza ("pertenece a otra marca") cualquier place cuya
-- brand_id no sea la de la campaña, así que un lugar compartido vía location_brand_shares NO se puede asociar
-- a la campaña de la marca receptora. Único cambio: aceptar también la marca con acceso compartido vigente.
-- Todo lo demás de la función queda idéntico.
CREATE OR REPLACE FUNCTION public.campaign_locations_validate()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
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

  IF TG_OP = 'INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    IF NOT v_loc.is_active THEN
      RAISE EXCEPTION 'El lugar "%" está desactivado', v_loc.name USING ERRCODE = 'check_violation';
    END IF;
    IF v_loc.type = 'influencer_home' OR v_loc.owner_influencer_id IS NOT NULL THEN
      RAISE EXCEPTION 'Un domicilio de influencer no puede ser dirección de campaña'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_loc.brand_id IS NOT NULL THEN
      SELECT * INTO v_campaign FROM public.campaigns WHERE id = NEW.campaign_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La campaña no existe' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF v_loc.brand_id IS DISTINCT FROM v_campaign.brand_id
         AND v_loc.brand_id IS DISTINCT FROM v_campaign.created_by_brand_id
         AND NOT EXISTS (  -- NUEVO: lugar compartido con la marca de la campaña (no privado)
           SELECT 1 FROM public.location_brand_shares s
           WHERE s.location_id = v_loc.id AND NOT v_loc.is_private
             AND s.brand_id IN (v_campaign.brand_id, v_campaign.created_by_brand_id)
         ) THEN
        RAISE EXCEPTION 'El lugar "%" pertenece a otra marca', v_loc.name USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NOT NEW.is_primary
     AND NOT EXISTS (SELECT 1 FROM public.campaign_locations WHERE campaign_id = NEW.campaign_id) THEN
    NEW.is_primary := true;
  END IF;

  RETURN NEW;
END;
$function$;
-- Rollback: reponer la versión anterior (sin el bloque NOT EXISTS) con el mismo CREATE OR REPLACE.
