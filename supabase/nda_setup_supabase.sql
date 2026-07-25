-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Crea Templates y los documentos NDA de Marca. No elimina ni modifica datos existentes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  campaign_type TEXT,
  document_type TEXT NOT NULL DEFAULT 'contract' CHECK (document_type IN ('contract', 'nda', 'policy', 'other')),
  language TEXT NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en')),
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL DEFAULT '',
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'contract' CHECK (document_type IN ('contract', 'nda', 'policy', 'other')),
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en')),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.contract_templates ALTER COLUMN campaign_type DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_templates_org ON public.contract_templates(organization_id);

CREATE TABLE IF NOT EXISTS public.brand_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL DEFAULT 'nda' CHECK (document_type IN ('nda', 'contract', 'policy', 'other')),
  language TEXT NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'voided', 'superseded')),
  template_version INTEGER NOT NULL DEFAULT 1,
  content_snapshot TEXT NOT NULL,
  signer_name TEXT,
  signer_rut TEXT,
  signer_role TEXT,
  signer_email TEXT,
  accepted_at TIMESTAMPTZ,
  acceptance_ip INET,
  signed_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  initial_email_sent_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  final_reminder_sent_at TIMESTAMPTZ,
  signed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_documents_brand ON public.brand_documents(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brand_documents_status ON public.brand_documents(brand_id, status);
ALTER TABLE public.brand_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.brand_documents
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS initial_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_reminder_sent_at TIMESTAMPTZ;

DROP POLICY IF EXISTS "brand_documents_owner_read" ON public.brand_documents;
CREATE POLICY "brand_documents_owner_read" ON public.brand_documents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.brands b WHERE b.id = brand_documents.brand_id AND b.user_id = auth.uid())
  );
