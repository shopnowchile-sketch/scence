create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),

  source      text not null default 'sii_pymes_2023',
  imported_at timestamptz not null default now(),

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
  company_size       text,
  website            text,
  position            text,
  position_filter     text,
  industry            text,
  industry_filter     text,
  employee_count      text,
  email               text,
  email_result        text,
  email_reason        text,
  email_status_code   text,
  email_role_account  text,
  email_free_domain   text,
  email_domain        text,

  qualification_status text not null default 'unqualified',
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
;
