-- Instagram/Apify is the only writer of verified social metrics.
-- Application route handlers use the service role after their own canonical
-- authorization checks, so authenticated clients do not need direct writes.

drop policy if exists inf_social_profiles_insert on public.influencer_social_profiles;
drop policy if exists inf_social_profiles_update on public.influencer_social_profiles;

revoke insert, update, delete on table public.influencer_social_profiles
from authenticated, anon;

