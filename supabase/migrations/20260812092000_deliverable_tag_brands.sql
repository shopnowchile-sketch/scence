-- La configuración de tags deja de vivir solo dentro del JSON de plantilla.
-- Cada campaign_deliverable conserva las marcas y handles de su propia pieza.

ALTER TABLE public.campaign_deliverables
  ADD COLUMN IF NOT EXISTS tag_brand_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS tag_handles text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_tag_brand_ids
  ON public.campaign_deliverables USING gin (tag_brand_ids);
