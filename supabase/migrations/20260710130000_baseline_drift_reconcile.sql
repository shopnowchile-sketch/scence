-- ============================================================================
-- Batch 0 — Baseline / reconciliación de drift
-- ----------------------------------------------------------------------------
-- Objetivo: registrar en migraciones el esquema que YA existe en producción y
-- que no estaba versionado (tabla campaign_brands e invoices.brand_id).
--
-- 100% IDEMPOTENTE y NO DESTRUCTIVA:
--   * NO recrea tablas existentes (CREATE TABLE IF NOT EXISTS)
--   * NO borra ni transforma datos
--   * NO modifica policies RLS existentes (solo las crea si faltan)
--   * En producción es un no-op total; en un entorno limpio reproduce prod.
--
-- Definición extraída de producción (proyecto xzzbishzfyovrladcaeb) el 2026-07-10.
-- ============================================================================

-- ── 1. campaign_brands ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_brands (
  id           uuid        NOT NULL DEFAULT uuid_generate_v4(),
  campaign_id  uuid        NOT NULL,
  brand_id     uuid        NOT NULL,
  role         text        NOT NULL DEFAULT 'co_sponsor',
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  assigned_by  uuid,
  CONSTRAINT campaign_brands_pkey PRIMARY KEY (id),
  CONSTRAINT campaign_brands_campaign_id_brand_id_key UNIQUE (campaign_id, brand_id),
  CONSTRAINT campaign_brands_campaign_id_fkey FOREIGN KEY (campaign_id)
    REFERENCES public.campaigns(id) ON DELETE CASCADE,
  CONSTRAINT campaign_brands_brand_id_fkey FOREIGN KEY (brand_id)
    REFERENCES public.brands(id) ON DELETE CASCADE,
  CONSTRAINT campaign_brands_assigned_by_fkey FOREIGN KEY (assigned_by)
    REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_brands_campaign ON public.campaign_brands (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_brands_brand    ON public.campaign_brands (brand_id);

-- RLS (ya habilitada en prod; ENABLE es idempotente)
ALTER TABLE public.campaign_brands ENABLE ROW LEVEL SECURITY;

-- Policy existente en prod: crear SOLO si falta (no toca la existente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'campaign_brands'
      AND policyname = 'campaign_brands_authenticated'
  ) THEN
    CREATE POLICY campaign_brands_authenticated
      ON public.campaign_brands
      FOR ALL
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- ── 2. invoices.brand_id (marca receptora) ──────────────────────────────────
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS brand_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND contype  = 'f'
      AND conname ILIKE '%brand%'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_brand_id_fkey FOREIGN KEY (brand_id)
      REFERENCES public.brands(id) ON DELETE SET NULL;
  END IF;
END $$;
