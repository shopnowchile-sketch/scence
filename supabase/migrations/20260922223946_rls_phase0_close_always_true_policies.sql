-- SCENCE rls_phase0 v2 · rollback: ops.rls_snapshots id='rls_phase0_pre_20260922'
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname='public'
             and (coalesce(qual,'') || coalesce(with_check,'')) ~ 'SELECT (\w+)\.organization_id\s+FROM profiles'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
drop policy if exists brand_locations_service_all on public.brand_locations;
drop policy if exists campaign_brands_authenticated on public.campaign_brands;
drop policy if exists campaign_brand_applications_authenticated on public.campaign_brand_applications;
drop policy if exists barters_admin_all on public.barters;
drop policy if exists barters_finance_read on public.barters;
drop policy if exists bsh_admin_all on public.barter_status_history;
drop policy if exists bsh_finance_read on public.barter_status_history;
drop policy if exists locations_admin_all on public.locations;
drop policy if exists "Admins can manage brand influencers" on public.brand_influencers;
drop policy if exists profiles_own on public.profiles;
drop policy if exists orgs_member_read on public.organizations;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy org_members_select_self on public.organization_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy organizations_select_member on public.organizations
  for select to authenticated using (
    id in (select om.organization_id from public.organization_members om
           where om.user_id = (select auth.uid()) and om.is_active = true));
revoke execute on function public.increment_affiliate_link_clicks(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_affiliate_link_totals(uuid) from public, anon, authenticated;
revoke execute on function public.user_can_access_brand(uuid) from anon;
