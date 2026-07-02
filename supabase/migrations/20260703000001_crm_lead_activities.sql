-- Historial de acciones por lead del CRM (email enviado, calificado, nota, etc.)
-- Aislado, no toca otras tablas salvo FK a crm_leads (nueva) y profiles (solo lectura del autor).
create table public.crm_lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  action_type text not null, -- email_sent | qualified | rejected | note | contacted | converted
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index crm_lead_activities_lead_id_idx on public.crm_lead_activities (lead_id);
create index crm_lead_activities_created_at_idx on public.crm_lead_activities (created_at);

alter table public.crm_lead_activities enable row level security;
-- Sin policies para anon/authenticated a propósito — solo service role (mismo criterio que crm_leads).
