-- Solicitudes antes de crear la relación activa campaign_brands.
CREATE TABLE IF NOT EXISTS public.campaign_brand_applications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved_for_payment', 'active', 'rejected')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, brand_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_brand_applications_campaign ON public.campaign_brand_applications(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_brand_applications_brand ON public.campaign_brand_applications(brand_id, status);
ALTER TABLE public.campaign_brand_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_brand_applications_authenticated" ON public.campaign_brand_applications
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
