-- SCENCE tenant split 2026-09-23 · snapshot: ops.rls_snapshots 'tenant_split_pre_20260923' · mapeo: ops.tenant_split_20260923
create table if not exists ops.tenant_split_20260923 (
  brand_id uuid primary key, brand_name text, new_org_id uuid not null, old_override text,
  preserved_override boolean not null, member_user_ids uuid[] not null, created_at timestamptz default now());
revoke all on ops.tenant_split_20260923 from public, anon, authenticated;

insert into ops.tenant_split_20260923 (brand_id, brand_name, new_org_id, old_override, preserved_override, member_user_ids)
select b.id, b.name, gen_random_uuid(), b.subscription_plan_override, b.subscription_plan_override is null,
       coalesce((select array_agg(om.user_id) from public.organization_members om
                 where om.organization_id = b.organization_id and om.brand_id = b.id and om.role <> 'super_admin'), '{}')
from public.brands b
where b.organization_id = 'd23d88ee-944a-4f0d-9060-f0ad9f76f092';

insert into public.organizations (id, slug, name, type, country, currency)
select m.new_org_id,
       left(coalesce(nullif(trim(both '-' from regexp_replace(lower(m.brand_name), '[^a-z0-9]+', '-', 'g')), ''), 'brand'), 50)
         || '-' || left(replace(m.brand_id::text, '-', ''), 6),
       trim(m.brand_name), 'brand', o.country, o.currency
from ops.tenant_split_20260923 m
cross join public.organizations o where o.id = 'd23d88ee-944a-4f0d-9060-f0ad9f76f092';

update public.organization_members om set organization_id = m.new_org_id
from ops.tenant_split_20260923 m
where om.organization_id = 'd23d88ee-944a-4f0d-9060-f0ad9f76f092' and om.brand_id = m.brand_id and om.role <> 'super_admin';

update public.brands b set organization_id = m.new_org_id,
       subscription_plan_override = case when m.preserved_override then 'pro' else b.subscription_plan_override end
from ops.tenant_split_20260923 m where b.id = m.brand_id;
