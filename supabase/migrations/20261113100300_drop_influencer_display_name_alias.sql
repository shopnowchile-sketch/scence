-- El alias temporal display_name(influencers) ya no lo usa ningún código: el nombre se lee solo como user_name.
DROP FUNCTION IF EXISTS public.display_name(public.influencers);
