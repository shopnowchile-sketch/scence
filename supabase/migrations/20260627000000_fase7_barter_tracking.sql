-- ════════════════════════════════════════════════════════════════════════════
-- FASE 7 · Tracking de canjes (barters)
-- Tabla de historial de estados + trigger de auto-log.
-- El trigger captura TODO cambio de estado, venga del API o de Studio.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tabla de historial ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.barter_status_history (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  barter_id       uuid NOT NULL REFERENCES public.barters(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_status     barter_status,
  to_status       barter_status NOT NULL,
  changed_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barter_status_history_barter
  ON public.barter_status_history (barter_id, created_at DESC);

COMMENT ON TABLE public.barter_status_history IS
  'Historial de la máquina de estados de canjes. Poblado automáticamente por trigger trg_log_barter_status.';

-- ── Función de log (SECURITY DEFINER para escribir el historial sin fricción RLS) ─
CREATE OR REPLACE FUNCTION public.log_barter_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_note  text;
BEGIN
  -- El API setea estas GUC con set_config('app.actor_id', ...) antes del UPDATE.
  -- Si el cambio viene de Studio, quedan NULL pero el historial igual se registra.
  v_actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  v_note  := NULLIF(current_setting('app.barter_note', true), '');

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.barter_status_history
      (barter_id, organization_id, from_status, to_status, changed_by, note)
    VALUES
      (NEW.id, NEW.organization_id, NULL, NEW.status,
       COALESCE(v_actor, NEW.created_by), v_note);
    RETURN NEW;
  END IF;

  IF (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    INSERT INTO public.barter_status_history
      (barter_id, organization_id, from_status, to_status, changed_by, note)
    VALUES
      (NEW.id, NEW.organization_id, OLD.status, NEW.status,
       COALESCE(v_actor, NEW.created_by), v_note);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_barter_status ON public.barters;
CREATE TRIGGER trg_log_barter_status
  AFTER INSERT OR UPDATE OF status ON public.barters
  FOR EACH ROW
  EXECUTE FUNCTION public.log_barter_status_change();

-- ── RLS: mismo aislamiento que barters (el API usa service_role / bypass) ──────
ALTER TABLE public.barter_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bsh_admin_all ON public.barter_status_history;
CREATE POLICY bsh_admin_all ON public.barter_status_history
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role = ANY (ARRAY['super_admin'::user_role, 'agency_manager'::user_role]))
  );

DROP POLICY IF EXISTS bsh_finance_read ON public.barter_status_history;
CREATE POLICY bsh_finance_read ON public.barter_status_history
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'finance'::user_role)
  );

DROP POLICY IF EXISTS bsh_brand_read_own ON public.barter_status_history;
CREATE POLICY bsh_brand_read_own ON public.barter_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM barters b
      WHERE b.id = barter_status_history.barter_id
        AND (
          b.brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid())
          OR b.brand_id IN (SELECT brand_id FROM brand_members
                            WHERE user_id = auth.uid() AND is_active = true)
        )
    )
  );

DROP POLICY IF EXISTS bsh_influencer_read_own ON public.barter_status_history;
CREATE POLICY bsh_influencer_read_own ON public.barter_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM barters b
      JOIN influencers inf ON inf.id = b.influencer_id
      WHERE b.id = barter_status_history.barter_id
        AND inf.user_id = auth.uid()
    )
  );

-- ── Backfill: registrar el estado actual de canjes preexistentes ──────────────
INSERT INTO public.barter_status_history
  (barter_id, organization_id, from_status, to_status, changed_by, note)
SELECT b.id, b.organization_id, NULL, b.status, b.created_by, 'Backfill estado inicial'
FROM public.barters b
WHERE NOT EXISTS (
  SELECT 1 FROM public.barter_status_history h WHERE h.barter_id = b.id
);

-- ── RPC atómico para avanzar estado con atribución de actor + nota ────────────
-- El API llama a este RPC: setea las GUC en scope de transacción y hace el UPDATE,
-- de modo que el trigger registre quién hizo el cambio y por qué.
CREATE OR REPLACE FUNCTION public.advance_barter_status(
  p_barter_id    uuid,
  p_status       barter_status,
  p_actor        uuid,
  p_note         text DEFAULT NULL,
  p_evidence_url text DEFAULT NULL
) RETURNS public.barters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.barters;
BEGIN
  PERFORM set_config('app.actor_id',    COALESCE(p_actor::text, ''), true);
  PERFORM set_config('app.barter_note', COALESCE(p_note, ''),        true);

  UPDATE public.barters
     SET status       = p_status,
         evidence_url = COALESCE(p_evidence_url, evidence_url),
         updated_at   = now()
   WHERE id = p_barter_id
  RETURNING * INTO r;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_barter_status(uuid, barter_status, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
