-- Reversión de 20261021120000_requirements_atomic_operations.sql. Restaura el estado de producción medido el 2026-10-26.
drop function if exists public.propose_requirement_version(text, text, jsonb, jsonb, text, text, uuid);
drop function if exists public.approve_requirement_version(text, uuid, uuid);
drop function if exists public.add_requirement_evidence(text, uuid, text, text, text, text, uuid);

grant insert, update, delete on public.requirements, public.requirement_versions, public.requirement_evidence to authenticated;

drop policy if exists "requirement_versions_platform_admin_update" on public.requirement_versions;
create policy "requirement_versions_platform_admin_update" on public.requirement_versions
  for update to authenticated
  using (
    exists (select 1 from public.organization_members om
            where om.user_id = (select auth.uid()) and om.is_active = true and om.role = 'super_admin')
    and lifecycle_status = 'proposed')
  with check (
    exists (select 1 from public.organization_members om
            where om.user_id = (select auth.uid()) and om.is_active = true and om.role = 'super_admin'));
