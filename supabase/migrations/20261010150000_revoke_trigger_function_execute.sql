-- Seguridad: cinco funciones SECURITY DEFINER son solo de trigger y estaban expuestas como RPC
-- (/rest/v1/rpc/*) a anon y authenticated (advisor 0028/0029). Los triggers siguen disparando
-- porque Postgres valida EXECUTE al crear el trigger, no al dispararlo. El código de la app no
-- las llama por RPC. user_can_access_brand NO se toca: las políticas RLS la necesitan.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_barter_status_change() from public, anon, authenticated;
revoke execute on function public.sync_affiliate_link_totals() from public, anon, authenticated;
revoke execute on function public.sync_profile_role() from public, anon, authenticated;
revoke execute on function public.sync_started_paying_at() from public, anon, authenticated;

-- sync_profile_role era SECURITY DEFINER sin search_path fijo.
alter function public.sync_profile_role() set search_path = public;
