-- Operaciones transaccionales del piloto de requerimientos.
-- No ejecutar en producción durante la recuperación. Validar primero en entorno aislado.
-- Las rutas verifican sesión y super_admin; estas funciones solo son ejecutables por service_role.

-- El API usa service_role después de comprobar super_admin. Los usuarios
-- autenticados solo necesitan lectura; revocar escrituras directas evita saltarse
-- las operaciones transaccionales de propuesta/aprobación.
REVOKE INSERT, UPDATE, DELETE ON public.requirements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.requirement_versions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.requirement_evidence FROM authenticated;
GRANT SELECT ON public.requirements, public.requirement_versions, public.requirement_evidence TO authenticated;

-- Mantener aprobaciones inmutables también para cualquier escritura futura
-- que se haga con el rol authenticated; las operaciones oficiales usan RPC.
DROP POLICY IF EXISTS "requirement_versions_platform_admin_update" ON public.requirement_versions;
CREATE POLICY "requirement_versions_platform_admin_update" ON public.requirement_versions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
    ) AND lifecycle_status = 'proposed'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
    ) AND lifecycle_status = 'proposed'
  );

CREATE OR REPLACE FUNCTION public.propose_requirement_version(
  p_requirement_key text,
  p_definition text,
  p_business_rules jsonb,
  p_acceptance_criteria jsonb,
  p_change_reason text,
  p_impact_summary text,
  p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requirement public.requirements%ROWTYPE;
  v_version public.requirement_versions%ROWTYPE;
  v_next_number integer;
BEGIN
  SELECT * INTO v_requirement
  FROM public.requirements
  WHERE requirement_key = p_requirement_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'requirement_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_number
  FROM public.requirement_versions
  WHERE requirement_id = v_requirement.id;

  INSERT INTO public.requirement_versions (
    requirement_id, version_number, lifecycle_status, definition, business_rules,
    acceptance_criteria, change_reason, impact_summary, created_by
  ) VALUES (
    v_requirement.id, v_next_number, 'proposed', p_definition, p_business_rules,
    p_acceptance_criteria, p_change_reason, p_impact_summary, p_created_by
  )
  RETURNING * INTO v_version;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, changes
  ) VALUES (
    p_created_by, 'requirement.version_proposed', 'requirement', v_requirement.id,
    jsonb_build_object(
      'requirement_key', p_requirement_key,
      'version_id', v_version.id,
      'version_number', v_version.version_number
    )
  );

  RETURN jsonb_build_object('id', v_version.id, 'version_number', v_version.version_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_requirement_version(
  p_requirement_key text,
  p_version_id uuid,
  p_approved_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requirement public.requirements%ROWTYPE;
  v_version public.requirement_versions%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_requirement
  FROM public.requirements
  WHERE requirement_key = p_requirement_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'requirement_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_version
  FROM public.requirement_versions
  WHERE id = p_version_id AND requirement_id = v_requirement.id
  FOR UPDATE;

  IF NOT FOUND OR v_version.lifecycle_status <> 'proposed' THEN
    RAISE EXCEPTION 'version_not_proposed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.requirement_versions
  SET lifecycle_status = 'superseded'
  WHERE requirement_id = v_requirement.id
    AND lifecycle_status = 'approved'
    AND id <> p_version_id;

  UPDATE public.requirement_versions
  SET lifecycle_status = 'approved', approved_by = p_approved_by, approved_at = v_now
  WHERE id = p_version_id;

  UPDATE public.requirements
  SET approved_version_id = p_version_id,
      implementation_status = 'por_verificar',
      updated_at = v_now
  WHERE id = v_requirement.id;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, changes
  ) VALUES (
    p_approved_by, 'requirement.version_approved', 'requirement', v_requirement.id,
    jsonb_build_object('requirement_key', p_requirement_key, 'version_id', p_version_id)
  );

  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id);
END;
$$;

REVOKE ALL ON FUNCTION public.propose_requirement_version(text, text, jsonb, jsonb, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_requirement_version(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_requirement_version(text, text, jsonb, jsonb, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_requirement_version(text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.add_requirement_evidence(
  p_requirement_key text,
  p_version_id uuid,
  p_evidence_type text,
  p_reference text,
  p_details text,
  p_verification_status text,
  p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requirement public.requirements%ROWTYPE;
  v_evidence public.requirement_evidence%ROWTYPE;
BEGIN
  SELECT * INTO v_requirement
  FROM public.requirements
  WHERE requirement_key = p_requirement_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'requirement_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.requirement_versions
  WHERE id = p_version_id AND requirement_id = v_requirement.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.requirement_evidence (
    requirement_version_id, evidence_type, reference, details, verification_status, created_by
  ) VALUES (
    p_version_id, p_evidence_type, p_reference, p_details, p_verification_status, p_created_by
  )
  RETURNING * INTO v_evidence;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, changes
  ) VALUES (
    p_created_by, 'requirement.evidence_added', 'requirement', v_requirement.id,
    jsonb_build_object(
      'requirement_key', p_requirement_key,
      'version_id', p_version_id,
      'evidence_id', v_evidence.id,
      'evidence_type', p_evidence_type,
      'reference', p_reference,
      'verification_status', p_verification_status
    )
  );

  RETURN jsonb_build_object('id', v_evidence.id, 'requirement_version_id', p_version_id);
END;
$$;

REVOKE ALL ON FUNCTION public.add_requirement_evidence(text, uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_requirement_evidence(text, uuid, text, text, text, text, uuid) TO service_role;
