alter table public.subscriptions
  add column if not exists paypal_subscription_id text,
  add column if not exists paypal_payer_id text;

create unique index if not exists subscriptions_paypal_subscription_id_key
  on public.subscriptions (paypal_subscription_id)
  where paypal_subscription_id is not null;
