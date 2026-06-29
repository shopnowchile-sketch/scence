-- ============================================================
-- AUTO-ONBOARDING: crea profile + org cuando un user se registra
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_org_name TEXT;
  v_full_name TEXT;
BEGIN
  -- Pull metadata from auth.users
  v_full_name  := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_org_name   := COALESCE(NEW.raw_user_meta_data->>'organization_name', v_full_name || '''s Org');

  -- 1. Create profile
  INSERT INTO public.profiles (id, full_name, display_name, role)
  VALUES (
    NEW.id,
    v_full_name,
    split_part(v_full_name, ' ', 1),
    'agency_manager'
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Create organization
  INSERT INTO public.organizations (name, slug, type)
  VALUES (
    v_org_name,
    lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(NEW.id::text, 1, 8),
    'agency'
  )
  RETURNING id INTO v_org_id;

  -- 3. Add user as org owner
  INSERT INTO public.organization_members (organization_id, user_id, role, is_owner, joined_at)
  VALUES (v_org_id, NEW.id, 'agency_manager', TRUE, NOW())
  ON CONFLICT DO NOTHING;

  -- 4. Store org_id in user metadata so frontend can access it
  UPDATE auth.users
  SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('organization_id', v_org_id)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on new auth user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RLS: influencers visible to org members (missing from schema)
-- ============================================================

CREATE POLICY "influencers_org_read" ON influencers
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
    OR organization_id IS NULL  -- global influencer roster
  );

-- Campaign deliverables visible to org members
CREATE POLICY "deliverables_org_read" ON campaign_deliverables
  USING (
    campaign_id IN (
      SELECT c.id FROM campaigns c
      JOIN organization_members om ON om.organization_id = c.organization_id
      WHERE om.user_id = auth.uid() AND om.is_active = TRUE
    )
  );

-- Invoices visible to org members
CREATE POLICY "invoices_org_read" ON invoices
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Invoice line items via invoice
CREATE POLICY "invoice_items_org_read" ON invoice_line_items
  USING (
    invoice_id IN (
      SELECT id FROM invoices
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid() AND is_active = TRUE
      )
    )
  );

-- Payroll runs visible to org members
CREATE POLICY "payroll_runs_org_read" ON payroll_runs
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Payroll items via run
CREATE POLICY "payroll_items_org_read" ON payroll_items
  USING (
    payroll_run_id IN (
      SELECT id FROM payroll_runs
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid() AND is_active = TRUE
      )
    )
  );

-- Bookings visible to org members
CREATE POLICY "bookings_org_read" ON bookings
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- Contracts visible to org members
CREATE POLICY "contracts_org_read" ON contracts
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );
