-- organization_members remains the only runtime authorization source.
-- These two deterministic operational members were previously flattened to
-- brand_manager only because public.user_role did not include member.

UPDATE public.organization_members
SET role = 'member'::public.user_role
WHERE id IN (
  '1a7b4c2a-d40f-4d55-849b-463e5d59fd2b'::uuid,
  '29b59f60-902a-4b5e-837c-0bc393710c98'::uuid
)
  AND role = 'brand_manager'::public.user_role
  AND is_owner = false
  AND is_active = true;

DO $$
DECLARE
  corrected_count integer;
BEGIN
  SELECT count(*) INTO corrected_count
  FROM public.organization_members
  WHERE id IN (
    '1a7b4c2a-d40f-4d55-849b-463e5d59fd2b'::uuid,
    '29b59f60-902a-4b5e-837c-0bc393710c98'::uuid
  )
    AND role = 'member'::public.user_role
    AND is_owner = false
    AND is_active = true;

  IF corrected_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 deterministic member memberships, found %', corrected_count;
  END IF;
END $$;
