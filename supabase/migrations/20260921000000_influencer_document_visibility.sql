ALTER TABLE public.influencer_documents
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'approved_brands'));

CREATE INDEX IF NOT EXISTS idx_influencer_documents_visibility
  ON public.influencer_documents (influencer_id, visibility, created_at DESC);
