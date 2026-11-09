-- Seguimiento Pro manual (2026-11-09): plantillas editables desde el admin e
-- historial individual de envíos a influencers.
--
-- Dos tipos de correo, separados a propósito:
--   assistance → ayuda por un problema de pago/activación. NO respeta bajas
--                comerciales ni preferencias de campañas.
--   commercial → recordatorio/oferta. Respeta email_optouts (baja) y lleva link de baja.
-- Nada se envía automáticamente: solo lo dispara un admin desde la pantalla.
--
-- RLS habilitado SIN políticas, sin privilegios para anon/authenticated; solo
-- service_role (rutas que validan admin). Reversión: drop de ambas tablas.

create table if not exists public.influencer_email_templates (
  key         text primary key,
  kind        text not null check (kind in ('assistance','commercial')),
  name        text not null,
  subject     text not null check (char_length(subject) between 1 and 160),
  body        text not null check (char_length(body) between 1 and 5000),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

create table if not exists public.influencer_email_log (
  id            uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  template_key  text not null,
  kind          text not null check (kind in ('assistance','commercial')),
  to_email      text not null,
  subject       text not null,
  body          text not null,
  status        text not null check (status in ('sent','failed')),
  resend_id     text,
  error         text,
  dedupe_key    text,
  sent_by       uuid,
  created_at    timestamptz not null default now()
);

create index if not exists influencer_email_log_influencer_idx
  on public.influencer_email_log (influencer_id, created_at desc);

-- Guardia dura contra doble clic / carreras: una plantilla por influencer por día.
create unique index if not exists influencer_email_log_dedupe_uidx
  on public.influencer_email_log (dedupe_key) where status = 'sent' and dedupe_key is not null;

alter table public.influencer_email_templates enable row level security;
alter table public.influencer_email_log enable row level security;
revoke all on table public.influencer_email_templates from public, anon, authenticated;
revoke all on table public.influencer_email_log from public, anon, authenticated;
grant select, insert, update on table public.influencer_email_templates to service_role;
grant select, insert on table public.influencer_email_log to service_role;

insert into public.influencer_email_templates (key, kind, name, subject, body) values
('assistance_paypal', 'assistance', 'Asistencia: problema al activar Pro',
 '¿Tuviste un problema activando SCENCE Pro?',
 E'Vimos que intentaste activar SCENCE Pro y el proceso no quedó completo. Queremos ayudarte a resolverlo.\n\nSi aprobaste el pago en PayPal, no te preocupes: revisaremos tu caso para que no pagues dos veces. Si no, puedes retomar tu activación aquí:\n{{plan_url}}\n\nRespóndenos este correo y te ayudamos personalmente.'),
('recovery_pro', 'commercial', 'Comercial: retomar activación Pro',
 'Retoma tu activación de SCENCE Pro',
 E'Empezaste a activar SCENCE Pro y quedó pendiente. Con Pro puedes postular a campañas privadas con marcas.\n\nPuedes retomarlo cuando quieras aquí:\n{{plan_url}}\n\nSi tienes dudas, respóndenos y te ayudamos.'),
('followup_pro', 'commercial', 'Comercial: seguimiento Pro',
 'Novedades de campañas en SCENCE',
 E'Hay campañas privadas activas esperando influencers Pro.\n\nActiva tu plan aquí:\n{{plan_url}}\n\nSi tienes dudas, respóndenos y te ayudamos.')
on conflict (key) do nothing;
