-- Marcas colaboradoras comerciales por campaña (gifting / auspicios).
--
-- Una colaboración = estado y aporte de UNA marca/lead EN UNA campaña. La
-- identidad, contacto y notas siguen viviendo en crm_leads / brands /
-- crm_lead_activities (no se duplican).
--
-- NO reutiliza campaign_brands: esa tabla otorga acceso de portal y aparece en
-- el brief/tags de la campaña; un auspiciador "Por contactar" no debe tenerlo.
--
-- Solo admin de plataforma: RLS habilitado sin políticas para anon/authenticated;
-- las rutas /api/campaigns/[id]/collaborations usan service role tras validar
-- isPlatformAdmin().

CREATE TABLE public.campaign_brand_collaborations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id             UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  brand_id            UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'to_contact'
                      CHECK (status IN ('to_contact', 'contacted', 'negotiating', 'confirmed', 'declined')),
  collaboration_type  TEXT
                      CHECK (collaboration_type IN ('gifting', 'products', 'services', 'cash', 'mixed')),
  contribution_detail TEXT CHECK (char_length(contribution_detail) <= 500),
  quantity            INTEGER CHECK (quantity IS NULL OR quantity >= 0),
  next_step           TEXT CHECK (char_length(next_step) <= 300),
  follow_up_date      DATE,
  owner_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_brand_collaborations_has_entity CHECK (lead_id IS NOT NULL OR brand_id IS NOT NULL)
);

-- Sin asociaciones duplicadas por campaña.
CREATE UNIQUE INDEX campaign_brand_collaborations_campaign_lead_key
  ON public.campaign_brand_collaborations (campaign_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX campaign_brand_collaborations_campaign_brand_key
  ON public.campaign_brand_collaborations (campaign_id, brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX campaign_brand_collaborations_lead_idx
  ON public.campaign_brand_collaborations (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX campaign_brand_collaborations_brand_idx
  ON public.campaign_brand_collaborations (brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX campaign_brand_collaborations_owner_idx
  ON public.campaign_brand_collaborations (owner_id) WHERE owner_id IS NOT NULL;

ALTER TABLE public.campaign_brand_collaborations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campaign_brand_collaborations FROM PUBLIC, anon, authenticated;

-- Notas/historial: se reutiliza crm_lead_activities. Columna aditiva y nullable
-- para distinguir lo que se escribió desde una campaña concreta.
ALTER TABLE public.crm_lead_activities
  ADD COLUMN campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL;
CREATE INDEX crm_lead_activities_campaign_idx
  ON public.crm_lead_activities (campaign_id) WHERE campaign_id IS NOT NULL;
