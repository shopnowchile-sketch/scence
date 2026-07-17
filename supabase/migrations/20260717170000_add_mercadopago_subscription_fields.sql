-- Suscripciones SCENCE vía Mercado Pago.
-- Conserva columnas Stripe históricas, pero la aplicación deja de usarlas.

alter table public.subscriptions
  add column if not exists mercadopago_subscription_id text,
  add column if not exists mercadopago_payer_id text;

create unique index if not exists subscriptions_mercadopago_subscription_id_key
  on public.subscriptions (mercadopago_subscription_id)
  where mercadopago_subscription_id is not null;

alter table public.brands
  add column if not exists subscription_plan_override_expires_at timestamptz;

alter table public.brands
  drop constraint if exists brands_subscription_plan_override_check;

-- Los planes pagados solo se habilitan desde una suscripción confirmada por
-- Mercado Pago. Conservamos únicamente las cortesías Free manuales.
update public.brands
set subscription_plan_override = null,
    subscription_plan_override_expires_at = null
where subscription_plan_override is not null
  and subscription_plan_override <> 'free';

alter table public.brands
  add constraint brands_subscription_plan_override_check
  check (
    subscription_plan_override is null
    or subscription_plan_override = 'free'
  );

comment on column public.brands.subscription_plan_override is
  'Plan manual asignado por SCENCE. Free nunca genera cobros.';
comment on column public.brands.subscription_plan_override_expires_at is
  'Vencimiento opcional del plan manual. NULL significa sin vencimiento.';

-- El enum histórico llama "starter" al tier que la app presenta como Basic.
-- Se reutiliza para no romper suscripciones ni migraciones antiguas.
update public.subscription_plans set
  name = 'Basic',
  description = 'Para marcas que comienzan a trabajar con creadoras.',
  price_monthly = 67000,
  price_yearly = null,
  max_users = 5,
  max_campaigns = 1,
  max_influencers = 5,
  is_active = true
where tier = 'starter';

update public.subscription_plans set
  name = 'Growth',
  description = 'Para marcas que necesitan escalar sus campañas.',
  price_monthly = 497000,
  price_yearly = null,
  max_users = 10,
  max_campaigns = null,
  max_influencers = 50,
  is_active = true
where tier = 'growth';

update public.subscription_plans set
  name = 'Pro',
  description = 'Acceso completo para marcas y equipos de alto volumen.',
  price_monthly = 697000,
  price_yearly = null,
  max_users = null,
  max_campaigns = null,
  max_influencers = null,
  is_active = true
where tier = 'pro';

update public.subscription_plans set is_active = false where tier = 'enterprise';
