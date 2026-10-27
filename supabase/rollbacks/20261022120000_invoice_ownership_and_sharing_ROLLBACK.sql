-- Reversión de 20261022120000_invoice_ownership_and_sharing.sql. Restaura el estado de producción medido el 2026-10-26.
-- ADVERTENCIA: borrar owner_brand_id e invoice_shares descarta cualquier propiedad o acceso compartido asignado
-- después de aplicar la migración. Respaldar antes (ops.invoices_backup_*, ops.invoice_shares_backup_*).
drop policy if exists invoices_platform_admin_select on public.invoices;
drop policy if exists invoice_line_items_platform_admin_select on public.invoice_line_items;

drop policy if exists invoices_org_read on public.invoices;
create policy invoices_org_read on public.invoices
  for all to public
  using (organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true));

drop policy if exists invoice_items_org_read on public.invoice_line_items;
create policy invoice_items_org_read on public.invoice_line_items
  for all to public
  using (invoice_id in (
    select i.id from public.invoices i
    where i.organization_id in (
      select om.organization_id from public.organization_members om
      where om.user_id = auth.uid() and om.is_active = true)));

grant delete, insert, references, select, trigger, truncate, update on public.invoices, public.invoice_line_items to anon, authenticated;

drop table if exists public.invoice_shares;
drop trigger if exists trg_invoices_protect_ownership on public.invoices;
drop function if exists public.invoices_protect_ownership();
drop function if exists public.invoice_shares_validate();
drop index if exists public.idx_invoices_owner_brand;
alter table public.invoices drop column if exists owner_brand_id;
