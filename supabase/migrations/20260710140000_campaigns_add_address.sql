-- ============================================================================
-- Batch 2 — Dirección / ubicación de campaña
-- ----------------------------------------------------------------------------
-- Agrega la ubicación donde se realizará la campaña.
-- NO destructiva: columna nullable, sin defaults que reescriban filas, sin
-- tocar datos existentes. Idempotente (ADD COLUMN IF NOT EXISTS).
-- ============================================================================

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN public.campaigns.address IS
  'Dirección/ubicación donde se realizará la campaña (evento, activación, etc.). Texto libre.';
