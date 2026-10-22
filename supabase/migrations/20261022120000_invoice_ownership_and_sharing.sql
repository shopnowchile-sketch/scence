-- Facturación: propiedad explícita por marca, acceso compartido de solo lectura
-- y cierre de las políticas RLS heredadas.
--
-- REVISABLE, NO APLICADA. No ejecutar contra producción ni bases remotas sin
-- aprobación explícita. Es aditiva salvo el punto 4 (reemplaza políticas que
-- están versionadas en 20260527000001_auth_hooks.sql y coinciden con producción).
--
-- Semántica de columnas (no mezclar):
--   organization_id  = organización contable donde vive el registro. NO es propiedad.
--   brand_id         = marca RECEPTORA/pagadora (legado: lo escriben la factura automática
--                      al completar campaña y la de marca colaboradora). NO es propiedad.
--   owner_brand_id   = marca PROPIETARIA: la que creó la factura y puede gestionarla.
--                      NULL = emitida por SCENCE (o histórica sin propietario verificable):
--                      ninguna marca tiene acceso, solo la administración de plataforma.
--
-- Facturas históricas: NO se asigna propietario. A la fecha de la auditoría
-- (2026-10-22) había 10 facturas, todas en la organización de la agencia, 9
-- emitidas por un administrador de plataforma; 6 con brand_id nulo y 2 con
-- brand_id distinto de la marca de su campaña. Quedan con owner_brand_id NULL
-- (solo admin). Un propietario se asigna caso a caso, con evidencia, por un
-- administrador (el trigger permite NULL -> valor una sola vez).

-- ── 1. Propiedad explícita ──────────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS owner_brand_id uuid REFERENCES public.brands(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.invoices.owner_brand_id IS
  'Marca propietaria (creadora). NULL = SCENCE/histórica: solo admin de plataforma. Inmutable una vez asignada. brand_id es la marca receptora y NO concede acceso.';

CREATE INDEX IF NOT EXISTS idx_invoices_owner_brand
  ON public.invoices(owner_brand_id) WHERE owner_brand_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.invoices_protect_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.owner_brand_id IS NOT NULL AND NEW.owner_brand_id IS DISTINCT FROM OLD.owner_brand_id THEN
    RAISE EXCEPTION 'invoice_owner_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_protect_ownership ON public.invoices;
CREATE TRIGGER trg_invoices_protect_ownership
  BEFORE UPDATE OF owner_brand_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_protect_ownership();

REVOKE EXECUTE ON FUNCTION public.invoices_protect_ownership() FROM PUBLIC, anon, authenticated;

-- ── 2. Acceso compartido (solo lectura) ─────────────────────────────────────
-- Una fila por (factura, marca destinataria). Revocar = status 'revoked'; volver a
-- compartir reactiva la misma fila. Conceder acceso NUNCA otorga edición, pagos,
-- borrado ni re-compartir: eso lo decide el código de la ruta (invoice-access.ts).
CREATE TABLE IF NOT EXISTS public.invoice_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  UNIQUE (invoice_id, brand_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_invoice_shares_brand_active
  ON public.invoice_shares(brand_id) WHERE status = 'active';

-- Una factura no se comparte con su propia marca propietaria.
CREATE OR REPLACE FUNCTION public.invoice_shares_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = NEW.invoice_id AND i.owner_brand_id = NEW.brand_id) THEN
    RAISE EXCEPTION 'invoice_share_to_owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_shares_validate ON public.invoice_shares;
CREATE TRIGGER trg_invoice_shares_validate
  BEFORE INSERT OR UPDATE OF invoice_id, brand_id ON public.invoice_shares
  FOR EACH ROW EXECUTE FUNCTION public.invoice_shares_validate();

REVOKE EXECUTE ON FUNCTION public.invoice_shares_validate() FROM PUBLIC, anon, authenticated;

-- RLS activo SIN políticas: ningún rol de usuario accede directo; solo service_role
-- (las rutas, que verifican propiedad y permisos antes de leer o escribir).
ALTER TABLE public.invoice_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_shares FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.invoice_shares TO service_role;

-- ── 3. Cierre de la brecha de RLS/grants heredados ─────────────────────────
-- Versionadas en 20260527000001_auth_hooks.sql y presentes en producción: `invoices_org_read` e `invoice_items_org_read`: FOR ALL,
-- rol public, USING (organization_id ∈ organizaciones del usuario), sin WITH CHECK.
-- Cualquier miembro activo de la organización de la factura (cualquier rol, también
-- `member` sin permiso de facturación) podía LEER y ESCRIBIR directo vía PostgREST,
-- saltándose las rutas. Además `authenticated` tenía INSERT/UPDATE/DELETE/TRUNCATE.
-- Todas las rutas de facturas usan service_role, así que no dependen de estas políticas.
DROP POLICY IF EXISTS invoices_org_read ON public.invoices;
DROP POLICY IF EXISTS invoice_items_org_read ON public.invoice_line_items;

-- Lectura directa solo para administradores de plataforma (defensa en profundidad).
-- Las marcas leen exclusivamente por las rutas, que aplican propiedad y acceso compartido.
DROP POLICY IF EXISTS invoices_platform_admin_select ON public.invoices;
CREATE POLICY invoices_platform_admin_select ON public.invoices
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (SELECT auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));

DROP POLICY IF EXISTS invoice_line_items_platform_admin_select ON public.invoice_line_items;
CREATE POLICY invoice_line_items_platform_admin_select ON public.invoice_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (SELECT auth.uid()) AND om.is_active = true AND om.role = 'super_admin'
  ));

REVOKE ALL ON public.invoices, public.invoice_line_items FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.invoices, public.invoice_line_items FROM authenticated;

-- ── Diagnóstico para asignar propietarios históricos (NO se ejecuta aquí) ───
-- Facturas sin propietario y la marca de su campaña, para que un administrador
-- decida con evidencia. No asignar solo por coincidencia de brand_id.
--   SELECT i.id, i.invoice_number, i.status, i.brand_id AS receptora,
--          COALESCE(c.created_by_brand_id, c.brand_id) AS marca_de_campana
--   FROM public.invoices i LEFT JOIN public.campaigns c ON c.id = i.campaign_id
--   WHERE i.owner_brand_id IS NULL ORDER BY i.created_at;
