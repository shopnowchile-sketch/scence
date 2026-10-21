-- Requerimientos funcionales versionados. Esta migración es aditiva y no se
-- debe aplicar fuera de un entorno de desarrollo autorizado.

CREATE TABLE IF NOT EXISTS public.requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_key TEXT NOT NULL UNIQUE,
  portal TEXT NOT NULL CHECK (portal IN ('Admin', 'Marca', 'Influencer', 'Plataforma')),
  module TEXT NOT NULL,
  functionality TEXT NOT NULL,
  title TEXT NOT NULL,
  implementation_status TEXT NOT NULL DEFAULT 'por_verificar'
    CHECK (implementation_status IN ('implementado', 'parcial', 'pendiente', 'por_verificar')),
  approved_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.requirement_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES public.requirements(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  lifecycle_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (lifecycle_status IN ('proposed', 'approved', 'superseded')),
  definition TEXT NOT NULL,
  business_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_reason TEXT NOT NULL,
  impact_summary TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requirement_id, version_number)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requirements_approved_version_fk') THEN
    ALTER TABLE public.requirements
      ADD CONSTRAINT requirements_approved_version_fk
      FOREIGN KEY (approved_version_id) REFERENCES public.requirement_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.requirement_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_version_id UUID NOT NULL REFERENCES public.requirement_versions(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('code', 'document', 'test', 'impact', 'deviation', 'validation')),
  reference TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('passed', 'pending', 'failed')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requirement_version_id, evidence_type, reference)
);

CREATE INDEX IF NOT EXISTS idx_requirement_versions_requirement
  ON public.requirement_versions(requirement_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_requirement_evidence_version
  ON public.requirement_evidence(requirement_version_id, evidence_type);

ALTER TABLE public.requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requirement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requirement_evidence ENABLE ROW LEVEL SECURITY;

-- Acceso directo permitido solo a administradores reales de plataforma. Las
-- rutas también verifican esto en servidor antes de usar service_role.
DROP POLICY IF EXISTS "requirements_platform_admin_select" ON public.requirements;
CREATE POLICY "requirements_platform_admin_select" ON public.requirements
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
      AND om.is_active = true
      AND om.role = 'super_admin'
  ));
DROP POLICY IF EXISTS "requirements_platform_admin_update" ON public.requirements;
CREATE POLICY "requirements_platform_admin_update" ON public.requirements
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));
DROP POLICY IF EXISTS "requirement_versions_platform_admin_select" ON public.requirement_versions;
CREATE POLICY "requirement_versions_platform_admin_select" ON public.requirement_versions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));
DROP POLICY IF EXISTS "requirement_versions_platform_admin_insert" ON public.requirement_versions;
CREATE POLICY "requirement_versions_platform_admin_insert" ON public.requirement_versions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));
DROP POLICY IF EXISTS "requirement_versions_platform_admin_update" ON public.requirement_versions;
CREATE POLICY "requirement_versions_platform_admin_update" ON public.requirement_versions
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ) AND lifecycle_status = 'proposed')
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));
DROP POLICY IF EXISTS "requirement_evidence_platform_admin_select" ON public.requirement_evidence;
CREATE POLICY "requirement_evidence_platform_admin_select" ON public.requirement_evidence
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));
DROP POLICY IF EXISTS "requirement_evidence_platform_admin_insert" ON public.requirement_evidence;
CREATE POLICY "requirement_evidence_platform_admin_insert" ON public.requirement_evidence
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (select auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));

-- Baseline aprobado: el estado permanece por verificar hasta ejecutar la
-- validación contra un entorno con datos reales. Sentencias separadas: un
-- UPDATE dentro del mismo WITH no ve las filas insertadas por esa sentencia.
INSERT INTO public.requirements (requirement_key, portal, module, functionality, title, implementation_status)
VALUES ('DASH-001', 'Admin', 'Dashboard', 'Indicadores operativos', 'Visualizar el KPI real de influencers activos', 'por_verificar')
ON CONFLICT (requirement_key) DO NOTHING;

INSERT INTO public.requirement_versions (
  requirement_id, version_number, lifecycle_status, definition, business_rules,
  acceptance_criteria, change_reason, impact_summary, approved_at
)
SELECT id, 1, 'approved',
  'El sistema debe mostrar en el Dashboard Admin el número real de influencers activos del roster SCENCE.',
  '["El KPI se calcula únicamente para influencers de la organización SCENCE activa.", "Solo se cuentan registros con is_active = true.", "El portal Marca e Influencer no puede consultar este agregado Admin."]'::jsonb,
  '["GET /api/dashboard devuelve el conteo filtrado por organization_id e is_active=true.", "El Dashboard Admin presenta ese valor como KPI de influencers activos.", "Una prueba de regresión verifica el filtro is_active=true."]'::jsonb,
  'Baseline del piloto de requerimientos versionados.',
  'Código: src/app/api/dashboard/route.ts y DashboardClient.tsx. Documentación: FUNCTIONAL_DESIGN.md §3.1 AD-01. Prueba: tests/requirements-dashboard-kpi.test.ts.', now()
FROM public.requirements WHERE requirement_key = 'DASH-001'
ON CONFLICT (requirement_id, version_number) DO NOTHING;

UPDATE public.requirements r
SET approved_version_id = v.id, updated_at = now()
FROM public.requirement_versions v
WHERE r.requirement_key = 'DASH-001' AND r.approved_version_id IS NULL
  AND v.requirement_id = r.id AND v.version_number = 1 AND v.lifecycle_status = 'approved';

INSERT INTO public.requirement_evidence (requirement_version_id, evidence_type, reference, details, verification_status)
SELECT id, 'code', 'src/app/api/dashboard/route.ts', 'Consulta de influencers delimitada por organization_id e is_active=true.', 'pending'
FROM public.requirement_versions
WHERE requirement_id = (SELECT id FROM public.requirements WHERE requirement_key = 'DASH-001') AND version_number = 1
ON CONFLICT (requirement_version_id, evidence_type, reference) DO NOTHING;

-- Privilegios explícitos (no depender de default privileges del entorno).
-- RLS limita a authenticated a super_admin; el resto de roles no tiene acceso.
REVOKE ALL ON public.requirements, public.requirement_versions, public.requirement_evidence FROM anon;
GRANT ALL ON public.requirements, public.requirement_versions, public.requirement_evidence TO service_role;
GRANT SELECT, UPDATE ON public.requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.requirement_versions TO authenticated;
GRANT SELECT, INSERT ON public.requirement_evidence TO authenticated;
