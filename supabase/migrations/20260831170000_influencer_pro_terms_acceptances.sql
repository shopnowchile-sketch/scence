CREATE TABLE IF NOT EXISTS public.influencer_terms_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  document_key TEXT NOT NULL,
  document_title TEXT NOT NULL,
  document_version TEXT NOT NULL,
  content_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'revoked')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acceptance_ip INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (influencer_id, document_key, document_version)
);

CREATE INDEX IF NOT EXISTS idx_influencer_terms_acceptances_history
  ON public.influencer_terms_acceptances (influencer_id, accepted_at DESC);

ALTER TABLE public.influencer_terms_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "influencer_terms_acceptances_self_read"
  ON public.influencer_terms_acceptances FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.influencer_terms_acceptances FROM authenticated;
