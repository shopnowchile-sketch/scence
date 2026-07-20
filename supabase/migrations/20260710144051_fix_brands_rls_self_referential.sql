
drop policy if exists "brands_select_own_org" on public.brands;
drop policy if exists "brands_insert_own_org" on public.brands;
drop policy if exists "brands_update_own_org" on public.brands;
drop policy if exists "brands_delete_own_org" on public.brands;

create policy "brands_select_owner_only"
on public.brands
for select
to authenticated
using (user_id = auth.uid());
;
