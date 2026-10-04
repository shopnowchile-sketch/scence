-- SCENCE: synchronize brand users with their canonical organization membership.
-- This prevents brand accounts from being created without the membership needed
-- for brand-scoped RLS.

create or replace function public.ensure_brand_owner_org_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null and new.organization_id is not null then
    insert into public.organization_members
      (organization_id, user_id, role, is_owner, is_active, joined_at, brand_id)
    values
      (new.organization_id, new.user_id, 'brand_manager'::public.user_role,
       true, true, coalesce(new.created_at, now()), new.id)
    on conflict (organization_id, user_id) do update
      set is_active = true,
          is_owner = true,
          role = 'brand_manager'::public.user_role,
          brand_id = coalesce(public.organization_members.brand_id, excluded.brand_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_brand_owner_org_membership on public.brands;
create trigger trg_ensure_brand_owner_org_membership
after insert or update of user_id, organization_id on public.brands
for each row execute function public.ensure_brand_owner_org_membership();

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

  v_role := case
    when new.role = 'finance' then 'finance'::public.user_role
    else 'brand_manager'::public.user_role
  end;

  insert into public.organization_members
    (organization_id, user_id, role, is_owner, is_active, invited_at, joined_at, brand_id)
  values
    (v_org_id, new.user_id, v_role, false, true, new.invited_at,
     coalesce(new.joined_at, now()), new.brand_id)
  on conflict (organization_id, user_id) do update
    set is_active = true,
        role = excluded.role,
        brand_id = coalesce(public.organization_members.brand_id, excluded.brand_id);

  return new;
end;
$$;

drop trigger if exists trg_ensure_brand_member_org_membership on public.brand_members;
create trigger trg_ensure_brand_member_org_membership
after insert or update of user_id, brand_id, is_active, role on public.brand_members
for each row execute function public.ensure_brand_member_org_membership();

create or replace function public.ensure_brand_auth_org_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_id uuid;
  v_org_id uuid;
begin
  if coalesce(new.raw_user_meta_data ->> 'is_brand', 'false') <> 'true' then
    return new;
  end if;

  if coalesce(new.raw_user_meta_data ->> 'brand_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  v_brand_id := (new.raw_user_meta_data ->> 'brand_id')::uuid;

  select b.organization_id into v_org_id
  from public.brands b
  where b.id = v_brand_id;

  if v_org_id is null then
    return new;
  end if;

  insert into public.organization_members
    (organization_id, user_id, role, is_owner, is_active, joined_at, brand_id)
  values
    (v_org_id, new.id, 'brand_manager'::public.user_role, true, true, now(), v_brand_id)
  on conflict (organization_id, user_id) do update
    set is_active = true,
        is_owner = true,
        role = 'brand_manager'::public.user_role,
        brand_id = coalesce(public.organization_members.brand_id, excluded.brand_id);

  return new;
end;
$$;

drop trigger if exists trg_ensure_brand_auth_org_membership on auth.users;
create trigger trg_ensure_brand_auth_org_membership
after insert on auth.users
for each row execute function public.ensure_brand_auth_org_membership();

insert into public.organization_members
  (organization_id, user_id, role, is_owner, is_active, joined_at, brand_id)
select
  b.organization_id,
  u.id,
  'brand_manager'::public.user_role,
  true,
  true,
  now(),
  b.id
from auth.users u
join public.brands b
  on b.id = case
    when coalesce(u.raw_user_meta_data ->> 'brand_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (u.raw_user_meta_data ->> 'brand_id')::uuid
    else null
  end
join public.profiles p on p.id = u.id and p.role = 'brand_manager'::public.user_role
where coalesce(u.raw_user_meta_data ->> 'is_brand','false') = 'true'
on conflict (organization_id, user_id) do update
  set is_active = true,
      is_owner = true,
      role = 'brand_manager'::public.user_role,
      brand_id = coalesce(public.organization_members.brand_id, excluded.brand_id);

revoke all on function public.ensure_brand_owner_org_membership() from public, anon, authenticated;
revoke all on function public.ensure_brand_member_org_membership() from public, anon, authenticated;
revoke all on function public.ensure_brand_auth_org_membership() from public, anon, authenticated;
