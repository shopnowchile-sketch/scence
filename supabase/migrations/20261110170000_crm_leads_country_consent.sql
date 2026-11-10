-- CRM: país del contacto y evidencia de consentimiento comercial.
-- country: nombre del país según el catálogo `locations` (level='country'); NULL = no identificado con certeza.
-- marketing_consent: true = hay evidencia de consentimiento (p. ej. "Accepts Marketing"); NULL = desconocido.
-- Las bajas, rebotes y quejas siguen viviendo en `email_optouts` (fuente única).
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS marketing_consent boolean;
