CREATE TABLE IF NOT EXISTS public.influencer_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('portfolio', 'identity', 'other')),
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_influencer_documents_owner
  ON public.influencer_documents (influencer_id, created_at DESC);

ALTER TABLE public.influencer_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "influencer_documents_self_read" ON public.influencer_documents
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.influencers i WHERE i.id = influencer_documents.influencer_id AND i.user_id = (select auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.influencer_documents FROM authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('influencer-private-documents', 'influencer-private-documents', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
