-- Limpieza: columnas de Stripe/MercadoPago sin datos ni dependientes y 5 tablas vacías sin consumidores ni FK entrantes.
-- Verificado el 2026-10-27 en producción: 0 filas con valor en las 9 columnas; ninguna función, vista ni política las usa;
-- las 5 tablas tienen 0 filas, ningún FK entrante, ningún trigger y ninguna referencia en el código. PayPal es la única pasarela.
-- Aborta si apareciera algún dato. Reversión: supabase/rollbacks/20261027120000_..._ROLLBACK.sql
-- Mantener la comprobación y los DROP en una sola transacción (apply_migration).
-- Evita una escritura entre la comprobación de vacío y la eliminación; no espera indefinidamente.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.subscriptions, public.organizations, public.invoices, public.subscription_plans,
  public.booking_checkins, public.campaign_status_history, public.contract_signatures,
  public.crm_email_history, public.oneclick_inscriptions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL
             OR mercadopago_payer_id IS NOT NULL OR mercadopago_subscription_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.organizations WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.invoices WHERE stripe_invoice_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.subscription_plans WHERE stripe_price_id_monthly IS NOT NULL OR stripe_price_id_yearly IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.booking_checkins) OR EXISTS (SELECT 1 FROM public.campaign_status_history)
     OR EXISTS (SELECT 1 FROM public.contract_signatures) OR EXISTS (SELECT 1 FROM public.crm_email_history)
     OR EXISTS (SELECT 1 FROM public.oneclick_inscriptions) THEN
    RAISE EXCEPTION 'drop_unused_payment_columns_and_empty_tables: hay datos; no se elimina nada';
  END IF;
END $$;

ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS stripe_customer_id, DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS mercadopago_payer_id, DROP COLUMN IF EXISTS mercadopago_subscription_id;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS stripe_customer_id, DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE public.invoices DROP COLUMN IF EXISTS stripe_invoice_id;
ALTER TABLE public.subscription_plans DROP COLUMN IF EXISTS stripe_price_id_monthly, DROP COLUMN IF EXISTS stripe_price_id_yearly;

DROP TABLE IF EXISTS public.booking_checkins, public.campaign_status_history, public.contract_signatures,
  public.crm_email_history, public.oneclick_inscriptions;
