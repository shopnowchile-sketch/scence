-- Transición segura: organization_members pasa a ser la autorización canónica
-- del portal Marca. Conserva brand_members durante la migración gradual.

INSERT INTO public.organization_members (
  organization_id, user_id, role, is_owner, is_active, joined_at
)
SELECT
  b.organization_id,
  b.user_id,
  'brand_manager'::public.user_role,
  true,
  true,
  COALESCE(b.created_at, now())
FROM public.brands b
WHERE b.user_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO UPDATE
SET is_owner = true,
    is_active = true,
    role = EXCLUDED.role,
    joined_at = COALESCE(public.organization_members.joined_at, EXCLUDED.joined_at);

INSERT INTO public.organization_members (
  organization_id, user_id, role, is_owner, is_active, invited_at, joined_at
)
SELECT
  b.organization_id,
  bm.user_id,
  CASE WHEN bm.role = 'finance' THEN 'finance'::public.user_role ELSE 'brand_manager'::public.user_role END,
  false,
  true,
  bm.invited_at,
  COALESCE(bm.joined_at, now())
FROM public.brand_members bm
JOIN public.brands b ON b.id = bm.brand_id
WHERE bm.user_id IS NOT NULL
  AND bm.is_active = true
ON CONFLICT (organization_id, user_id) DO UPDATE
SET is_active = true,
    role = EXCLUDED.role,
    invited_at = COALESCE(public.organization_members.invited_at, EXCLUDED.invited_at),
    joined_at = COALESCE(public.organization_members.joined_at, EXCLUDED.joined_at);
