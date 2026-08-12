-- Corrige los escapes de la expresión regular de la migración inicial para
-- que URLs de Instagram también se normalicen al backfillear datos existentes.

CREATE OR REPLACE FUNCTION public.normalize_brand_instagram_handle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.instagram_handle_normalized := NULLIF(
    lower(regexp_replace(regexp_replace(trim(coalesce(NEW.instagram, '')), '^https?://(www\.)?instagram\.com/', '', 'i'), '^@', '')),
    ''
  );
  NEW.instagram_handle_normalized := regexp_replace(NEW.instagram_handle_normalized, '/+$', '');
  RETURN NEW;
END;
$$;

UPDATE public.brands
SET instagram_handle_normalized = NULLIF(
  regexp_replace(lower(regexp_replace(regexp_replace(trim(coalesce(instagram, '')), '^https?://(www\.)?instagram\.com/', '', 'i'), '^@', '')), '/+$', ''),
  ''
)
WHERE instagram IS NOT NULL;
