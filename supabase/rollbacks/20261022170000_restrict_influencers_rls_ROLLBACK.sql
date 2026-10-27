-- Reversión de 20261022170000_restrict_influencers_rls.sql. Restaura el estado de producción medido el 2026-10-26.
drop policy if exists influencers_member_read on public.influencers;
drop policy if exists influencers_member_write on public.influencers;
drop policy if exists "influencers_org_read" on public.influencers;
create policy "influencers_org_read" on public.influencers
  for all to public
  using (
    (organization_id in (
      select om.organization_id from public.organization_members om
      where om.user_id = auth.uid() and om.is_active = true))
    or (organization_id is null));
grant insert, update, delete, truncate, trigger, references on public.influencers to anon;
grant truncate, trigger, references on public.influencers to authenticated;
