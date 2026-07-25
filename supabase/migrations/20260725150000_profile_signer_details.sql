ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signer_rut TEXT,
  ADD COLUMN IF NOT EXISTS signer_role TEXT;
