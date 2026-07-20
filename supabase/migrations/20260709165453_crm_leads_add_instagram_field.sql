-- Campo dedicado para handle/URL de Instagram, separado de contact_name (persona)
-- y website (sitio propio). Antes se guardaba mezclado, causando confusión entre
-- "contacto" (persona/email) e "Instagram" (canal social).
alter table public.crm_leads add column instagram text;
create index crm_leads_instagram_idx on public.crm_leads (instagram);;
