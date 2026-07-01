-- Migración baseline (documentación) — tabla `brands`.
-- Gap G-15: la tabla `brands` existe y se usa activamente en producción (portal Marca,
-- campañas, RLS, etc.) pero nunca tuvo una migración de creación en el repo — quedó fuera
-- por drift entre entornos. Este archivo documenta el schema real (columnas, constraints,
-- índices y RLS) tal como existe hoy en producción (xzzbishzfyovrladcaeb), para que un
-- entorno nuevo levantado desde `supabase/migrations` no quede con `brands` faltante.
--
-- NO se ejecutó contra producción (la tabla ya existe ahí) — usa IF NOT EXISTS / guards
-- para ser seguro de correr en cualquier entorno, incluido uno que ya tenga la tabla.

CREATE TABLE IF NOT EXISTS public.brands (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by            UUID REFERENCES auth.users(id),
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  logo_url              TEXT,
  website               TEXT,
  industry              TEXT,
  contact_name          TEXT,
  contact_email         TEXT,
  contact_phone         TEXT,
  additional_contacts   JSONB DEFAULT '[]'::jsonb,
  notes                 TEXT,
  rut                   TEXT,
  instagram             TEXT,
  address_street        TEXT,
  address_number        TEXT,
  address_city          TEXT,
  address_region        TEXT,
  address_country       TEXT DEFAULT 'Chile',
  address2_street       TEXT,
  address2_number       TEXT,
  address2_city         TEXT,
  address2_region       TEXT,
  address2_country      TEXT,
  status                TEXT NOT NULL DEFAULT 'pending_approval'
                          CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS brands_user_id_unique ON public.brands (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_brands_org    ON public.brands (organization_id);
CREATE INDEX IF NOT EXISTS idx_brands_user_id ON public.brands (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_brands_status  ON public.brands (status);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- ⚠️ ADVERTENCIA (encontrada al escribir esta baseline, 2026-07-01): estas 4 policies,
-- copiadas EXACTAS de producción vía pg_get_constraintdef/pg_policies, comparan
-- `brands.organization_id` contra una subquery que también selecciona `brands.organization_id`
-- (no `profiles.organization_id` — esa columna no existe en `profiles`). El resultado es
-- `brands.organization_id = brands.organization_id`, siempre verdadero mientras exista
-- CUALQUIER fila en `profiles` con `id = auth.uid()`. En la práctica esto NO filtra por
-- organización: cualquier usuario autenticado con un perfil puede leer/editar/borrar
-- CUALQUIER brand. Esto no se corrige en esta migración (es un cambio de RLS/permisos
-- sensible y separado, requiere su propio reporte de impacto y aprobación explícita —
-- ver regla del proyecto de "un solo cambio sensible de Auth/RLS por vez"). Se documenta
-- tal cual está en prod para que la baseline sea fiel a la realidad, no a lo que debería ser.

DROP POLICY IF EXISTS "brands_select_own_org" ON public.brands;
CREATE POLICY "brands_select_own_org" ON public.brands
  FOR SELECT USING (organization_id = (SELECT brands.organization_id FROM public.profiles WHERE profiles.id = auth.uid()));

DROP POLICY IF EXISTS "brands_insert_own_org" ON public.brands;
CREATE POLICY "brands_insert_own_org" ON public.brands
  FOR INSERT WITH CHECK (organization_id = (SELECT brands.organization_id FROM public.profiles WHERE profiles.id = auth.uid()));

DROP POLICY IF EXISTS "brands_update_own_org" ON public.brands;
CREATE POLICY "brands_update_own_org" ON public.brands
  FOR UPDATE USING (organization_id = (SELECT brands.organization_id FROM public.profiles WHERE profiles.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT brands.organization_id FROM public.profiles WHERE profiles.id = auth.uid()));

DROP POLICY IF EXISTS "brands_delete_own_org" ON public.brands;
CREATE POLICY "brands_delete_own_org" ON public.brands
  FOR DELETE USING (organization_id = (SELECT brands.organization_id FROM public.profiles WHERE profiles.id = auth.uid()));
