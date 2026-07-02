-- Módulo CRM (nuevo, aislado) — tabla de leads/prospectos para calificar
-- marcas antes de darlas de alta en SCENCE. NO modifica brands/influencers/
-- campaigns/auth. Fuente inicial: base SII 2023 (70.000 PYMES) subida por Pri.
--
-- Acceso: RLS habilitado SIN policies para anon/authenticated — solo el
-- service role (usado por las API routes vía createAdminClient(), mismo
-- patrón que el resto del admin panel) puede leer/escribir. No es org-scoped
-- porque es una lista interna de prospección, no data de ninguna organización
-- todavía.

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),

  source      text not null default 'sii_pymes_2023',
  imported_at timestamptz not null default now(),

  -- Campos crudos del CSV, preservados tal cual (sin normalizar)
  contact_name       text,
  phone_1            text,
  phone_2            text,
  contact_rut        text,
  address            text,
  commune            text,
  region             text,
  company_rut        text,
  company_dv         text,
  company_name       text,
  economic_activity  text,
  company_size       text,   -- TAMAÑO
  website            text,
  position            text,  -- CARGO
  position_filter     text,  -- FILTRO CARGO
  industry            text,  -- RUBRO
  industry_filter     text,  -- FILTRO RUBRO
  employee_count      text,  -- N° EMPLEADOS
  email               text,
  email_result        text,  -- RESULT
  email_reason        text,  -- REASON
  email_status_code   text,  -- STATUS CODE
  email_role_account  text,  -- ROLE (Yes/No — cuenta de rol tipo contacto@)
  email_free_domain   text,  -- FREE (Yes/No — dominio gratuito tipo gmail)
  email_domain        text,  -- DOMAIN

  -- Campos de trabajo del CRM (todos nuevos)
  qualification_status text not null default 'unqualified', -- unqualified | qualified | rejected | contacted | converted
  qualification_notes  text,
  qualified_at          timestamptz,
  contacted_at           timestamptz,
  converted_brand_id      uuid references public.brands(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_leads_company_rut_idx on public.crm_leads (company_rut);
create index crm_leads_region_idx on public.crm_leads (region);
create index crm_leads_qualification_status_idx on public.crm_leads (qualification_status);
create index crm_leads_email_idx on public.crm_leads (email);

alter table public.crm_leads enable row level security;
-- Sin policies para anon/authenticated a propósito — solo service role.
