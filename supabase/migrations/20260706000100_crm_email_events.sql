-- Tracking de emails CRM vía Resend Webhooks.
-- Aislado: solo referencia crm_leads. No toca marcas, campañas ni influencers.

create table if not exists public.crm_email_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete cascade,
  resend_email_id text,
  event_type text not null,
  recipient_email text,
  subject text,
  occurred_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_email_events_lead_id_idx on public.crm_email_events (lead_id);
create index if not exists crm_email_events_resend_email_id_idx on public.crm_email_events (resend_email_id);
create index if not exists crm_email_events_event_type_idx on public.crm_email_events (event_type);
create index if not exists crm_email_events_recipient_email_idx on public.crm_email_events (recipient_email);
create index if not exists crm_email_events_created_at_idx on public.crm_email_events (created_at);

alter table public.crm_email_events enable row level security;
-- Sin policies para anon/authenticated: solo service role vía API.
