-- Reversión de 20261027120000: recrea columnas y tablas vacías (sin datos que restaurar). Estructura medida en producción el 2026-10-27;
-- no recrea RLS ni FKs de las tablas (no tenían dependientes). Los índices únicos de las columnas se recrean abajo.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id text, ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS mercadopago_payer_id text, ADD COLUMN IF NOT EXISTS mercadopago_subscription_id text;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_key ON public.subscriptions (stripe_subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_mercadopago_subscription_id_key ON public.subscriptions (mercadopago_subscription_id);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS stripe_customer_id text, ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer ON public.organizations (stripe_customer_id);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS stripe_invoice_id text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_stripe_invoice_id_key ON public.invoices (stripe_invoice_id);
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS stripe_price_id_monthly text, ADD COLUMN IF NOT EXISTS stripe_price_id_yearly text;
CREATE TABLE IF NOT EXISTS public.booking_checkins (id uuid primary key default uuid_generate_v4(), booking_id uuid not null, checked_in_by uuid, checked_in_at timestamptz not null default now(), notes text, location_lat numeric, location_lng numeric);
CREATE TABLE IF NOT EXISTS public.campaign_status_history (id uuid primary key default uuid_generate_v4(), campaign_id uuid not null, changed_by uuid not null, from_status campaign_status, to_status campaign_status not null, reason text, created_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS public.contract_signatures (id uuid primary key default uuid_generate_v4(), contract_id uuid not null, signer_name text not null, signer_email text not null, signer_role text, signed_at timestamptz, ip_address inet, signature_data text, created_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS public.crm_email_history (id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null, sent_by uuid, to_email text not null, subject text not null, body text not null, status text not null default 'sent', provider_message_id text, error text, sent_at timestamptz not null default now(), created_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS public.oneclick_inscriptions (id uuid primary key default gen_random_uuid(), organization_id uuid not null, username text not null, tbk_user text not null, card_last4 text, card_type text, status text not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
