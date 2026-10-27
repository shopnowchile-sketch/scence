-- Reversión de 20261027120000. Catálogo de producción consultado el 2026-10-27.
-- Solo ejecutar después de la limpieza. Falla si existen objetos para evitar ocultar divergencias.
-- Las cinco tablas originales tienen RLS habilitado y CERO políticas (denegación por defecto).
BEGIN;
SET LOCAL search_path = public, extensions, pg_catalog;
ALTER TABLE public.subscriptions ADD COLUMN stripe_customer_id text, ADD COLUMN stripe_subscription_id text,
  ADD COLUMN mercadopago_payer_id text, ADD COLUMN mercadopago_subscription_id text;
ALTER TABLE public.organizations ADD COLUMN stripe_customer_id text, ADD COLUMN stripe_subscription_id text;
ALTER TABLE public.invoices ADD COLUMN stripe_invoice_id text;
ALTER TABLE public.subscription_plans ADD COLUMN stripe_price_id_monthly text, ADD COLUMN stripe_price_id_yearly text;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_stripe_invoice_id_key UNIQUE (stripe_invoice_id);
CREATE UNIQUE INDEX subscriptions_mercadopago_subscription_id_key ON public.subscriptions USING btree (mercadopago_subscription_id) WHERE (mercadopago_subscription_id IS NOT NULL);
CREATE INDEX idx_organizations_stripe_customer ON public.organizations USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);

CREATE TABLE public.booking_checkins (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  booking_id uuid NOT NULL,
  checked_in_by uuid,
  checked_in_at timestamp with time zone DEFAULT now() NOT NULL,
  notes text,
  location_lat numeric(10,7),
  location_lng numeric(10,7)
);
ALTER TABLE public.booking_checkins ADD CONSTRAINT booking_checkins_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
ALTER TABLE public.booking_checkins ADD CONSTRAINT booking_checkins_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES profiles(id);
ALTER TABLE public.booking_checkins ADD CONSTRAINT booking_checkins_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_checkins OWNER TO postgres;
ALTER TABLE public.booking_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_checkins NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_checkins FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.booking_checkins TO postgres, anon, authenticated, service_role;

CREATE TABLE public.oneclick_inscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  username text NOT NULL,
  tbk_user text NOT NULL,
  card_last4 text,
  card_type text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.oneclick_inscriptions ADD CONSTRAINT oneclick_inscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.oneclick_inscriptions ADD CONSTRAINT oneclick_inscriptions_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX oneclick_inscriptions_active_org_idx ON public.oneclick_inscriptions USING btree (organization_id) WHERE (status = 'active'::text);
CREATE INDEX oneclick_inscriptions_org_idx ON public.oneclick_inscriptions USING btree (organization_id);
ALTER TABLE public.oneclick_inscriptions OWNER TO postgres;
ALTER TABLE public.oneclick_inscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oneclick_inscriptions NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oneclick_inscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.oneclick_inscriptions TO postgres, anon, authenticated, service_role;

CREATE TABLE public.crm_email_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  sent_by uuid,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text DEFAULT 'sent'::text NOT NULL,
  provider_message_id text,
  error text,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.crm_email_history ADD CONSTRAINT crm_email_history_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE;
ALTER TABLE public.crm_email_history ADD CONSTRAINT crm_email_history_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.crm_email_history ADD CONSTRAINT crm_email_history_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_email_history ADD CONSTRAINT crm_email_history_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX crm_email_history_org_idx ON public.crm_email_history USING btree (organization_id);
CREATE INDEX crm_email_history_brand_idx ON public.crm_email_history USING btree (brand_id);
CREATE INDEX crm_email_history_sent_at_idx ON public.crm_email_history USING btree (sent_at DESC);
ALTER TABLE public.crm_email_history OWNER TO postgres;
ALTER TABLE public.crm_email_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_email_history NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_email_history FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.crm_email_history TO postgres, anon, authenticated, service_role;

CREATE TABLE public.campaign_status_history (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  campaign_id uuid NOT NULL,
  changed_by uuid NOT NULL,
  from_status campaign_status,
  to_status campaign_status NOT NULL,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.campaign_status_history ADD CONSTRAINT campaign_status_history_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE public.campaign_status_history ADD CONSTRAINT campaign_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES profiles(id);
ALTER TABLE public.campaign_status_history ADD CONSTRAINT campaign_status_history_pkey PRIMARY KEY (id);
ALTER TABLE public.campaign_status_history OWNER TO postgres;
ALTER TABLE public.campaign_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_status_history NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campaign_status_history FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.campaign_status_history TO postgres, anon, authenticated, service_role;

CREATE TABLE public.contract_signatures (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  contract_id uuid NOT NULL,
  signer_name text NOT NULL,
  signer_email text NOT NULL,
  signer_role text,
  signed_at timestamp with time zone,
  ip_address inet,
  signature_data text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.contract_signatures ADD CONSTRAINT contract_signatures_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE;
ALTER TABLE public.contract_signatures ADD CONSTRAINT contract_signatures_pkey PRIMARY KEY (id);
ALTER TABLE public.contract_signatures OWNER TO postgres;
ALTER TABLE public.contract_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_signatures NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contract_signatures FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.contract_signatures TO postgres, anon, authenticated, service_role;

COMMIT;
