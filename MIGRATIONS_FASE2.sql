-- ═══════════════════════════════════════════════════════════════════════════════
-- SCENCE — MIGRATIONS FASE 2 (safe to re-run)
-- Objetivo: vincular influencer_tasks con campaign_deliverables
-- Correr en: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Agregar deliverable_id a influencer_tasks ──────────────────────────────
-- Permite vincular 1:1 una task con su deliverable de origen.
-- nullable: las tasks genéricas (booking, event, manual) no tienen deliverable.
ALTER TABLE influencer_tasks
  ADD COLUMN IF NOT EXISTS deliverable_id UUID
    REFERENCES campaign_deliverables(id) ON DELETE CASCADE;

-- Índice para lookups rápidos (sincronización de status)
CREATE INDEX IF NOT EXISTS idx_influencer_tasks_deliverable
  ON influencer_tasks(deliverable_id)
  WHERE deliverable_id IS NOT NULL;

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────────
SELECT
  (SELECT column_name FROM information_schema.columns
    WHERE table_name = 'influencer_tasks' AND column_name = 'deliverable_id') AS deliverable_id_col,
  (SELECT to_regclass('public.idx_influencer_tasks_deliverable'))              AS deliverable_index;

-- RESULTADO ESPERADO:
--   deliverable_id_col  | deliverable_index
--   deliverable_id      | idx_influencer_tasks_deliverable
-- ═══════════════════════════════════════════════════════════════════════════════
