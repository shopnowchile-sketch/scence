-- Permite usar el estado comercial `suspended` que ya consume el portal.
-- Sin esta ampliación, PATCH /api/brands/:id falla porque la restricción
-- histórica solo aceptaba pending_approval, approved y rejected.
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT c.conname
    INTO existing_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'brands'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%'
    AND pg_get_constraintdef(c.oid) ILIKE '%approved%'
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.brands DROP CONSTRAINT %I', existing_constraint);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'brands'
      AND c.conname = 'brands_status_check'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_status_check
      CHECK (status IN ('pending_approval', 'approved', 'rejected', 'suspended'));
  END IF;
END $$;
