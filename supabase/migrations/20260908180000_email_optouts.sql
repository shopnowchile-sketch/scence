-- ─────────────────────────────────────────────────────────────────────────────
-- email_optouts — fuente única de verdad para bloquear ENVÍOS COMERCIALES.
--
-- ALCANCE: esta tabla la consultan SOLO los dos caminos comerciales del CRM
-- (src/lib/crm-bulk-send.ts y api/crm-leads/[id]/send-intro). Los ~39 puntos
-- de envío transaccional (accesos, aprobaciones, facturas, reportes, campañas,
-- soporte) NO la consultan y NO deben consultarla: una persona dada de baja de
-- la prospección comercial sigue recibiendo su contraseña y sus facturas.
--
-- Se indexa por EMAIL, no por lead: la misma dirección puede existir en varios
-- leads y el bloqueo sigue a la persona, no a la fila.
--
-- Aditiva: no altera ninguna tabla existente. Reversible con `drop table`.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.email_optouts (
  email             text primary key,
  reason            text not null,
  source            text,
  lead_id           uuid,
  resend_email_id   text,
  created_at        timestamptz not null default now(),
  constraint email_optouts_reason_check
    check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  -- La app normaliza antes de escribir; la constraint garantiza que nadie
  -- inserte "Hola@Scence.CL" y cree un bloqueo que las consultas no encuentran.
  constraint email_optouts_email_normalized
    check (email = lower(btrim(email)) and email <> '')
);

comment on table public.email_optouts is
  'Bloqueo de envíos COMERCIALES (prospección CRM). No afecta emails transaccionales.';
comment on column public.email_optouts.reason is
  'unsubscribe = baja voluntaria · bounce = rebote permanente o supresión de Resend · complaint = marcado como spam · manual = alta administrativa';

create index if not exists email_optouts_created_at_idx
  on public.email_optouts (created_at desc);

-- Solo service_role (createAdminClient) accede, igual que el resto del CRM.
-- RLS activo sin políticas = denegado por defecto para authenticated/anon.
alter table public.email_optouts enable row level security;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Rebotes PERMANENTES + direcciones ya suprimidas por Resend + quejas de spam.
-- Los rebotes TRANSIENT (MailboxFull, General transitorio) quedan FUERA a
-- propósito: son recuperables y bloquearlos perdería leads válidos.
insert into public.email_optouts (email, reason, source, resend_email_id, created_at)
select distinct on (lower(btrim(e.recipient_email)))
  lower(btrim(e.recipient_email)),
  case when e.event_type = 'email.complained' then 'complaint' else 'bounce' end,
  'backfill:' || e.event_type,
  e.resend_email_id,
  coalesce(e.occurred_at, e.created_at)
from public.crm_email_events e
where e.recipient_email is not null
  and btrim(e.recipient_email) <> ''
  and (
    e.event_type = 'email.complained'
    or e.event_type = 'email.suppressed'
    or (e.event_type = 'email.bounced'
        and lower(coalesce(e.raw_payload->'data'->'bounce'->>'type', '')) = 'permanent')
  )
order by
  lower(btrim(e.recipient_email)),
  case when e.event_type = 'email.complained' then 0 else 1 end,
  coalesce(e.occurred_at, e.created_at) asc
on conflict (email) do nothing;
