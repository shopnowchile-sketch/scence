-- SCENCE: brand campaign access must be assignment-based
-- Brand users may read only campaigns explicitly assigned to their brand
-- through campaign_brands (principal or collaborator). Internal SCENCE
-- users keep organization-based access.

drop policy if exists campaigns_org_read on public.campaigns;

create policy campaigns_org_read on public.campaigns
for select to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = campaigns.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
  )
  and not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'brand_manager'::public.user_role
  )
);

drop policy if exists deliverables_org_read on public.campaign_deliverables;

create policy deliverables_org_read on public.campaign_deliverables
for select to authenticated
using (
  exists (
    select 1
    from public.campaigns c
    join public.organization_members om
      on om.organization_id = c.organization_id
    where c.id = campaign_deliverables.campaign_id
      and om.user_id = auth.uid()
      and om.is_active = true
  )
  and not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'brand_manager'::public.user_role
  )
);

drop policy if exists campaigns_brand_assigned_read on public.campaigns;
create policy campaigns_brand_assigned_read on public.campaigns
for select to authenticated
using (
  exists (
    select 1
    from public.campaign_brands cb
    where cb.campaign_id = campaigns.id
      and public.user_can_access_brand(cb.brand_id)
  )
);

drop policy if exists deliverables_brand_assigned_read on public.campaign_deliverables;
create policy deliverables_brand_assigned_read on public.campaign_deliverables
for select to authenticated
using (
  exists (
    select 1
    from public.campaign_brands cb
    where cb.campaign_id = campaign_deliverables.campaign_id
      and public.user_can_access_brand(cb.brand_id)
  )
);

drop policy if exists campaign_brands_brand_access_read on public.campaign_brands;
create policy campaign_brands_brand_access_read on public.campaign_brands
for select to authenticated
using (
  public.user_can_access_brand(brand_id)
);
