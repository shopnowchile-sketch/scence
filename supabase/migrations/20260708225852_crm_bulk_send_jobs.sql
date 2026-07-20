create table if not exists crm_bulk_send_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  notify_email text,
  lead_ids uuid[] not null,
  subject text not null,
  message text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  cursor int not null default 0,
  total int not null,
  sent int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table crm_bulk_send_jobs enable row level security;
-- Mismo patrón que crm_leads/crm_email_events: sin policies, solo accesible
-- via service_role (admin client) desde los endpoints de la API.
;
