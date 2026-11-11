-- Restricción adicional: las políticas de lectura existentes siguen delimitando
-- las filas. Una sesión de Marca también necesita NDA para la campaña, salvo
-- un borrador propio de una marca pendiente que está completando su registro.
create schema if not exists ops;

create or replace function ops.brand_campaign_nda_allows(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with memberships as (
    select om.role, b.id as brand_id, b.status
    from public.organization_members om
    left join public.brands b on b.organization_id = om.organization_id
      and (om.brand_id is null or om.brand_id = b.id)
    where om.user_id = (select auth.uid()) and om.is_active = true
  ),
  member_brands as (
    select brand_id, status from memberships
    where role in ('brand_manager', 'member') and brand_id is not null
  )
  select exists (select 1 from memberships where role = 'super_admin')
    or not exists (select 1 from member_brands)
    or exists (
      select 1 from member_brands b
      join public.campaigns c on c.id = p_campaign_id
      where (
        b.brand_id = c.brand_id or b.brand_id = c.created_by_brand_id
        or exists (
          select 1 from public.campaign_brands cb
          where cb.campaign_id = c.id and cb.brand_id = b.brand_id
        )
      )
      and (
        (b.status = 'pending_approval' and c.status = 'draft' and c.created_by_brand_id = b.brand_id)
        or (
          (b.status = 'approved' or (b.status = 'pending_approval' and c.created_by_brand_id = b.brand_id))
          and exists (
            select 1 from public.brand_documents d
            where d.brand_id = b.brand_id and d.document_type = 'nda' and d.status = 'signed'
          )
        )
      )
    );
$$;

revoke all on function ops.brand_campaign_nda_allows(uuid) from public, anon;
grant execute on function ops.brand_campaign_nda_allows(uuid) to authenticated;

create policy brand_campaign_nda_gate on public.campaigns
  as restrictive for select to authenticated using (ops.brand_campaign_nda_allows(id));
create policy brand_campaign_nda_gate on public.campaign_brands
  as restrictive for select to authenticated using (ops.brand_campaign_nda_allows(campaign_id));
create policy brand_campaign_nda_gate on public.campaign_influencers
  as restrictive for select to authenticated using (ops.brand_campaign_nda_allows(campaign_id));
create policy brand_campaign_nda_gate on public.campaign_deliverables
  as restrictive for select to authenticated using (ops.brand_campaign_nda_allows(campaign_id));
create policy brand_campaign_nda_gate on public.bookings
  as restrictive for select to authenticated using (campaign_id is null or ops.brand_campaign_nda_allows(campaign_id));
