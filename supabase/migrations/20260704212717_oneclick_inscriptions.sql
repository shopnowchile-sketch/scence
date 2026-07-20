-- Transbank Oneclick Mall: tabla nueva para guardar el token de tarjeta
-- inscrita por marca (necesaria para poder cobrar el mes siguiente sin
-- que la marca vuelva a ingresar la tarjeta). No existe nada similar hoy
-- en el schema (subscription_plans/subscriptions no guardan medio de pago).
--
-- No se toca subscription_plans/subscriptions ni organizations. El plan
-- vigente sigue resolviéndose 100% con lib/plan-limits.ts +
-- organizations.subscription_plan / organizations.subscription_status
-- (columnas que ya existen), tal como decidido.

create table if not exists oneclick_inscriptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  username        text not null,
  tbk_user        text not null,
  card_last4      text,
  card_type       text,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists oneclick_inscriptions_active_org_idx
  on oneclick_inscriptions (organization_id)
  where status = 'active';

create index if not exists oneclick_inscriptions_org_idx
  on oneclick_inscriptions (organization_id);

alter table oneclick_inscriptions enable row level security;
;
