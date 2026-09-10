-- ============================================================
-- Ledger de pagos de suscripción + fecha real de inicio de pago
--
-- Problema que resuelve (auditoría 2026-09-10):
--   1. `subscriptions.current_period_start` guarda el período VIGENTE y los
--      webhooks lo sobrescriben en cada renovación → hoy no existe forma de
--      saber desde cuándo paga un cliente.
--   2. No hay registro de cobros individuales. `payments` está FK-ada a
--      `invoices` (facturación de campañas) y tiene 0 filas: usarla para
--      suscripciones obligaría a inventar una factura por cada cobro.
--   3. No se guarda ningún comprobante, ni el del gateway ni uno cargado
--      a mano para pagos fuera de plataforma (transferencia, Pro manual).
--
-- Decisión: UNA tabla para influencers y marcas, alimentada por los 3
-- gateways y por carga manual del admin. `subscriptions` e `invoices` no se
-- modifican salvo por la columna nueva.
-- ============================================================

-- (a) Fecha de inicio de pago — inmutable, la fija el trigger de más abajo
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS started_paying_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscriptions.started_paying_at IS
  'Primer pago confirmado de esta suscripción. Lo mantiene el trigger de subscription_payments. Los webhooks de renovación NO lo tocan.';

-- (b) Ledger
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id      UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id        UUID REFERENCES public.influencers(id) ON DELETE SET NULL,
  payer_type           TEXT NOT NULL CHECK (payer_type IN ('influencer', 'brand')),
  gateway              TEXT NOT NULL CHECK (gateway IN ('paypal', 'mercadopago', 'stripe', 'manual')),
  gateway_payment_id   TEXT,
  payment_method       TEXT,
  concept              TEXT NOT NULL DEFAULT 'Suscripción SCENCE Pro',
  amount               NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency             currency_code NOT NULL DEFAULT 'USD',
  status               payment_status NOT NULL DEFAULT 'completed',
  paid_at              TIMESTAMPTZ NOT NULL,
  period_start         TIMESTAMPTZ,
  period_end           TIMESTAMPTZ,
  receipt_url          TEXT,
  receipt_storage_path TEXT UNIQUE,
  receipt_filename     TEXT,
  receipt_mime_type    TEXT,
  receipt_file_size    BIGINT CHECK (receipt_file_size IS NULL OR (receipt_file_size > 0 AND receipt_file_size <= 10485760)),
  recorded_by          UUID REFERENCES public.profiles(id),
  notes                TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotencia de webhooks: un reintento de PayPal no puede duplicar el cobro.
  -- UNIQUE normal (no parcial) para que ON CONFLICT pueda inferirlo desde
  -- PostgREST; los pagos manuales van con gateway_payment_id NULL y en un
  -- índice UNIQUE los NULL no colisionan entre sí.
  CONSTRAINT subscription_payments_gateway_payment_key UNIQUE (gateway, gateway_payment_id)
);

COMMENT ON TABLE public.subscription_payments IS
  'Cobros de suscripción (influencer Pro y planes de marca) con su comprobante. Distinto de `payments`, que es la cobranza de facturas de campaña.';

CREATE INDEX IF NOT EXISTS idx_subscription_payments_org
  ON public.subscription_payments (organization_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_influencer
  ON public.subscription_payments (influencer_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription
  ON public.subscription_payments (subscription_id, paid_at DESC);

CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- (c) started_paying_at = el pago completado más antiguo. Siempre LEAST(),
--     así ni una renovación ni un backfill desordenado lo mueven hacia adelante.
CREATE OR REPLACE FUNCTION public.sync_started_paying_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND NEW.status = 'completed' THEN
    UPDATE public.subscriptions
       SET started_paying_at = LEAST(COALESCE(started_paying_at, NEW.paid_at), NEW.paid_at)
     WHERE id = NEW.subscription_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subscription_payments_started_paying
  AFTER INSERT OR UPDATE OF status, paid_at, subscription_id
  ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_started_paying_at();

-- (d) RLS — lectura propia. La escritura queda solo para service role, igual
--     que influencer_documents. Recordar (CLAUDE.md 16.2) que la protección
--     real la hace el chequeo de cada ruta, no RLS.
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_payments_influencer_self_read"
  ON public.subscription_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.influencers i
       WHERE i.id = subscription_payments.influencer_id
         AND i.user_id = (select auth.uid())
    )
  );

-- Miembros de organización: SOLO pagos de marca.
--
-- Verificado 2026-09-10 en producción: la organización que agrupa a las
-- influencers (d23d88ee) es COMPARTIDA — tiene 13 marcas y 8 brand_manager
-- (backfill del 2026-08-12), y TODAS las suscripciones de influencer cuelgan
-- de ella. Sin el filtro por payer_type, esos 8 brand_manager podrían leer
-- los pagos de las 2.187 influencers. El filtro cierra esa puerta.
--
-- Las influencers NO están en organization_members (verificado: 0 de 2.187),
-- así que sus pagos se leen solo por la política self_read de más arriba.
-- El panel admin no pierde nada: usa el service role, que no pasa por RLS.
CREATE POLICY "subscription_payments_org_member_read"
  ON public.subscription_payments
  FOR SELECT TO authenticated
  USING (
    payer_type = 'brand'
    AND EXISTS (
      SELECT 1 FROM public.organization_members m
       WHERE m.organization_id = subscription_payments.organization_id
         AND m.user_id = (select auth.uid())
         AND m.is_active
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.subscription_payments FROM authenticated;

-- (e) Bucket privado para comprobantes cargados a mano
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('subscription-receipts', 'subscription-receipts', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
