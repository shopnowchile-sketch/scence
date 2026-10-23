-- A brand member can be `member`, `finance` or `brand_manager`. The previous
-- trigger silently promoted `member` to `brand_manager` while synchronizing
-- organization_members, which granted campaign/team permissions incorrectly.
--
-- This is safe to apply more than once: CREATE OR REPLACE preserves the
-- trigger and only changes the role mapping for future inserts/updates. It
-- intentionally does not rewrite existing rows; correcting historical role
-- assignments requires an audited, approved data migration.

create or replace function public.ensure_brand_member_org_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role public.user_role;
begin
  if new.user_id is null or coalesce(new.is_active, false) = false then
    return new;
  end if;

  select b.organization_id into v_org_id
  from public.brands b
  where b.id = new.brand_id;

  if v_org_id is null then
    return new;
  end if;

  v_role := case new.role
    when 'finance' then 'finance'::public.user_role
    when 'member' then 'member'::public.user_role
    else 'brand_manager'::public.user_role
  end;

  insert into public.organization_members
    (organization_id, user_id, role, is_owner, is_active, invited_at, joined_at, brand_id)
  values
    (v_org_id, new.user_id, v_role, false, true, new.invited_at,
     coalesce(new.joined_at, now()), new.brand_id)
  on conflict (organization_id, user_id) do update
    set is_active = true,
        -- Nunca degradar a un owner ni a un super_admin existente en esta org.
        role = case
          when public.organization_members.is_owner
            or public.organization_members.role = 'super_admin'::public.user_role
          then public.organization_members.role
          else excluded.role
        end,
        brand_id = coalesce(public.organization_members.brand_id, excluded.brand_id);

  return new;
end;
$$;

revoke all on function public.ensure_brand_member_org_membership() from public, anon, authenticated;
