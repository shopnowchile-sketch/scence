-- Instagram es la identidad comercial global de una marca.
-- No borra duplicados históricos: conserva el más antiguo como canónico y
-- bloquea todo duplicado nuevo mediante el índice único.

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS instagram_handle_normalized text;

CREATE OR REPLACE FUNCTION public.normalize_brand_instagram_handle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.instagram_handle_normalized := NULLIF(
    lower(regexp_replace(regexp_replace(trim(coalesce(NEW.instagram, '')), '^https?://(www\\.)?instagram\\.com/', '', 'i'), '^@', '')),
    ''
  );
  NEW.instagram_handle_normalized := regexp_replace(NEW.instagram_handle_normalized, '/+$', '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_brand_instagram_handle ON public.brands;
CREATE TRIGGER trg_normalize_brand_instagram_handle
BEFORE INSERT OR UPDATE OF instagram ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.normalize_brand_instagram_handle();

UPDATE public.brands
SET instagram_handle_normalized = NULLIF(
  regexp_replace(lower(regexp_replace(regexp_replace(trim(coalesce(instagram, '')), '^https?://(www\\.)?instagram\\.com/', '', 'i'), '^@', '')), '/+$', ''),
  ''
)
WHERE instagram IS NOT NULL;

-- Si hay duplicados históricos, este índice se crea al resolverlos en el
-- backoffice; la aplicación ya reutiliza el primer registro existente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.brands
    WHERE instagram_handle_normalized IS NOT NULL
    GROUP BY instagram_handle_normalized
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS brands_instagram_handle_normalized_unique
      ON public.brands (instagram_handle_normalized)
      WHERE instagram_handle_normalized IS NOT NULL;
  ELSE
    RAISE NOTICE 'No se creó índice único de Instagram: existen duplicados históricos que requieren consolidación.';
  END IF;
END $$;
