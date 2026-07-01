-- Quitar agency_manager del modelo de roles activo.
-- Modelo real: super_admin (Admin, ve todo) | brand_manager (Brand, owner) | influencer (sin sub-roles).
-- No se dropea el valor del enum (innecesariamente riesgoso); solo deja de usarse.
-- Aplicado en producción (xzzbishzfyovrladcaeb) el 2026-07-01. Este archivo documenta el cambio
-- en el repo para que las migraciones no diverjan del schema real (ver gap G-15).

-- 1. Trigger de signup: dejaba 'agency_manager' hardcodeado en cada registro nuevo,
--    pero ensureOrg() ya lo sobreescribía a 'brand_manager' en el primer login real.
--    Se alinea el default para no dejar más filas nuevas en agency_manager.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_org_name TEXT;
  v_full_name TEXT;
BEGIN
  v_full_name  := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_org_name   := COALESCE(NEW.raw_user_meta_data->>'organization_name', v_full_name || '''s Org');

  INSERT INTO public.profiles (id, full_name, display_name, role)
  VALUES (
    NEW.id,
    v_full_name,
    split_part(v_full_name, ' ', 1),
    'brand_manager'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organizations (name, slug, type)
  VALUES (
    v_org_name,
    lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(NEW.id::text, 1, 8),
    'agency'
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, is_owner, joined_at)
  VALUES (v_org_id, NEW.id, 'brand_manager', TRUE, NOW())
  ON CONFLICT DO NOTHING;

  UPDATE auth.users
  SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('organization_id', v_org_id)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. RLS: quitar agency_manager de los 5 policies que lo referenciaban.
DROP POLICY IF EXISTS "admin_full_access_campaign_assets" ON campaign_assets;
CREATE POLICY "admin_full_access_campaign_assets" ON campaign_assets
  USING (organization_id IN (
    SELECT campaign_assets.organization_id
    FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'::user_role
  ));

DROP POLICY IF EXISTS "locations_admin_all" ON locations;
CREATE POLICY "locations_admin_all" ON locations
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'::user_role
  ));

DROP POLICY IF EXISTS "barters_admin_all" ON barters;
CREATE POLICY "barters_admin_all" ON barters
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'::user_role
  ));

DROP POLICY IF EXISTS "bsh_admin_all" ON barter_status_history;
CREATE POLICY "bsh_admin_all" ON barter_status_history
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'::user_role
  ));

DROP POLICY IF EXISTS "Admins can manage brand influencers" ON brand_influencers;
CREATE POLICY "Admins can manage brand influencers" ON brand_influencers
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'::user_role
  ));

-- 3. Reasignar los 2 perfiles reales que tenían agency_manager (ambos de prueba) a super_admin.
UPDATE profiles SET role = 'super_admin' WHERE role = 'agency_manager';
