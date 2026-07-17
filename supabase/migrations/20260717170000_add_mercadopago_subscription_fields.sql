alter table public.subscriptions
  add column if not exists mercadopago_subscription_id text,
  add column if not exists mercadopago_payer_id text;

create unique index if not exists subscriptions_mercadopago_subscription_id_key
  on public.subscriptions (mercadopago_subscription_id)
  where mercadopago_subscription_id is not null;
