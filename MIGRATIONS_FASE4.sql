-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — MIGRATIONS FASE 4: Portal de Marcas
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. brands — agregar user_id para vincular auth user con la marca ──────────
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brands_user_id
  ON brands(user_id) WHERE user_id IS NOT NULL;

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────
SELECT
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'brands' AND column_name = 'user_id') AS brands_user_id,
  (SELECT to_regclass('public.idx_brands_user_id'))           AS brands_user_idx;

-- RESULTADO ESPERADO:
--   brands_user_id | brands_user_idx
--   user_id        | idx_brands_user_id
-- ═══════════════════════════════════════════════════════════════════════════════
