grant execute on function public.handle_new_user() to public, anon, authenticated;
grant execute on function public.log_barter_status_change() to public, anon, authenticated;
grant execute on function public.sync_affiliate_link_totals() to public, anon, authenticated;
grant execute on function public.sync_profile_role() to public, anon, authenticated;
grant execute on function public.sync_started_paying_at() to public, anon, authenticated;
alter function public.sync_profile_role() reset search_path;
