-- Preguntas personalizadas de postulación (opcional, por campaña).
-- Mismo patrón que campaigns.deliverable_templates / campaign_influencers.deliverables_spec:
-- jsonb, default '[]', NOT NULL. Aditivo, no rompe filas existentes.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS application_questions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE campaign_influencers
  ADD COLUMN IF NOT EXISTS application_answers jsonb NOT NULL DEFAULT '[]'::jsonb;
;
