-- La lectura directa de brands debe usar organization_members como permiso
-- canónico. Se mantienen los vínculos legacy (brands.user_id y
-- brand_members) mientras termina la transición, para no cortar accesos
-- existentes. Las APIs continúan aplicando sus propias verificaciones.

CREATE OR REPLACE FUNCTION public.user_can_access_brand(target_brand_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'super_admin'::public.user_role
  )
  OR EXISTS (
    SELECT 1
    FROM public.brands b
    JOIN public.organization_members om
      ON om.organization_id = b.organization_id
    WHERE b.id = target_brand_id
      AND om.user_id = auth.uid()
      AND om.is_active = true
  )
  -- Compatibilidad temporal para organizaciones aún no backfilleadas.
  OR EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = target_brand_id
      AND b.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.brand_members bm
    WHERE bm.brand_id = target_brand_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_brand(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.user_can_access_brand(uuid) TO authenticated;

-- Esta es la única policy activa de SELECT para brands desde la migración
-- multiusuario. Se recrea para que use la función canónica de arriba.
DROP POLICY IF EXISTS brands_select_owner_or_member ON public.brands;
CREATE POLICY brands_select_owner_or_member
  ON public.brands
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_brand(id));
