# Plan — Registro de inicio de pago y comprobantes de suscripción

_Especificación para aprobación. No se ejecutó ningún cambio. Auditado 2026-09-10 sobre código local (`scence-app-clean`) y producción (Supabase `scence-app`)._

---

## 1. Estado real hoy (verificado, no supuesto)

**Datos en producción (2026-09-10):**

| Métrica | Valor |
|---|---|
| Filas en `subscriptions` | 42 |
| `status = active` | **7** |
| `status = incomplete` (checkouts abandonados) | 35 |
| Influencers distintos con fila | 28 |
| Suscripciones de marca (sin `influencer_id`) | 1 |
| Gateway usado | PayPal 42 · MercadoPago 0 · Stripe 0 |
| Pro manual activo (`influencers.metadata.manual_pro`) | 1 |
| Filas en `payments` | **0** |
| Filas en `invoices` | 10 (facturas de campaña, no suscripción) |
| Marcas con `subscription_plan_override` | 7 |
| Período activo más antiguo | 2026-09-07 |

**Gaps confirmados en código:**

1. `subscriptions.current_period_start` guarda el **período vigente**, y el webhook lo **sobrescribe en cada renovación** (`src/app/api/paypal/webhook/route.ts`, `mercadopago/webhook/route.ts`). No existe ninguna columna que preserve *cuándo empezó a pagar* el cliente.
2. **No existe registro de pagos individuales de suscripción.** `payments` está FK-ada a `invoices` (facturación de campañas a marcas) y tiene 0 filas — no sirve para suscripciones sin inventar una factura falsa por cobro.
3. **No se captura ningún comprobante.** El webhook de PayPal solo escucha `BILLING.SUBSCRIPTION.*`; ignora `PAYMENT.SALE.COMPLETED`, que es el evento que trae `transaction_id`, monto, moneda y fecha del cobro real. MercadoPago descarta todo lo que no sea `subscription_preapproval`.
4. **Pro manual no registra dinero.** `PATCH /api/influencers/[id]/pro` escribe `metadata.manual_pro = { active, granted_at, granted_by }` — sin monto, sin fecha de pago, sin comprobante. Igual `brands.subscription_plan_override` (7 marcas).
5. Consecuencia operativa: hoy no se puede responder *"¿desde cuándo paga este cliente y cuánto lleva pagado?"* ni entregar un respaldo ante una disputa o un contribuyente.

> **Ventana crítica:** las 7 suscripciones activas renuevan el **7-8 de octubre de 2026**. En esa renovación el webhook sobrescribe `current_period_start` y **se pierde la fecha real de inicio** de los primeros clientes pagos de SCENCE. El backfill (§5) debe correr antes de esa fecha, o habrá que reconstruirla desde la API de PayPal.

---

## 2. Recomendación

Un **ledger único de pagos de suscripción** (`subscription_payments`) + una columna inmutable `subscriptions.started_paying_at`, alimentado por los 3 gateways y por carga manual del admin. Una sola tabla, una sola verdad, sirve a influencers y marcas.

**Por qué así y no de otra forma:**

- Reutiliza lo que ya existe (`subscriptions`, buckets privados de Storage, patrón de upload de `influencer_documents`) en vez de crear un sistema paralelo.
- No toca `invoices` / `payments`, que son el circuito de facturación de campañas: mezclarlos obligaría a emitir una factura ficticia por cada cobro de suscripción.
- `started_paying_at` se calcula por trigger en base de datos, así los 4 puntos de entrada (3 webhooks + manual) producen el mismo resultado sin lógica duplicada.

---

## 3. Acción — cambios especificados

### 3.1 Migración `supabase/migrations/20260911090000_subscription_payments_ledger.sql`

```sql
-- (a) Fecha de inicio de pago, inmutable, nunca sobrescrita por renovaciones
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS started_paying_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscriptions.started_paying_at IS
  'Primer pago confirmado. Lo fija el trigger de subscription_payments. No lo tocan los webhooks de renovación.';

-- (b) Ledger de pagos de suscripción
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id       UUID REFERENCES public.influencers(id) ON DELETE SET NULL,
  payer_type          TEXT NOT NULL CHECK (payer_type IN ('influencer','brand')),
  gateway             TEXT NOT NULL CHECK (gateway IN ('paypal','mercadopago','stripe','manual')),
  gateway_payment_id  TEXT,
  payment_method      TEXT,                       -- transferencia, efectivo, tarjeta, otro
  concept             TEXT NOT NULL DEFAULT 'Suscripción SCENCE Pro',
  amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency            currency_code NOT NULL DEFAULT 'USD',
  status              payment_status NOT NULL DEFAULT 'completed',
  paid_at             TIMESTAMPTZ NOT NULL,
  period_start        TIMESTAMPTZ,
  period_end          TIMESTAMPTZ,
  receipt_url         TEXT,                       -- comprobante hospedado por el gateway
  receipt_storage_path TEXT UNIQUE,               -- comprobante subido a Storage
  receipt_filename    TEXT,
  receipt_mime_type   TEXT,
  receipt_file_size   BIGINT CHECK (receipt_file_size IS NULL OR (receipt_file_size > 0 AND receipt_file_size <= 10485760)),
  recorded_by         UUID REFERENCES public.profiles(id),  -- NULL = webhook
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotencia: un mismo cobro del gateway no puede duplicarse aunque el webhook reintente
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_gateway_payment_key
  ON public.subscription_payments (gateway, gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_org  ON public.subscription_payments (organization_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_inf  ON public.subscription_payments (influencer_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_sub  ON public.subscription_payments (subscription_id, paid_at DESC);

-- (c) started_paying_at = el pago completado más antiguo, siempre
CREATE OR REPLACE FUNCTION public.sync_started_paying_at() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND NEW.status = 'completed' THEN
    UPDATE public.subscriptions
       SET started_paying_at = LEAST(COALESCE(started_paying_at, NEW.paid_at), NEW.paid_at)
     WHERE id = NEW.subscription_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_subscription_payments_started_paying
  AFTER INSERT OR UPDATE OF status, paid_at ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_started_paying_at();

-- (d) RLS: lectura propia; escritura solo service role (mismo patrón que influencer_documents)
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_payments_influencer_self_read" ON public.subscription_payments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.influencers i
             WHERE i.id = subscription_payments.influencer_id AND i.user_id = (select auth.uid()))
  );

CREATE POLICY "subscription_payments_org_member_read" ON public.subscription_payments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.organization_members m
             WHERE m.organization_id = subscription_payments.organization_id
               AND m.user_id = (select auth.uid()))
  );

REVOKE INSERT, UPDATE, DELETE ON public.subscription_payments FROM authenticated;

-- (e) Bucket privado para comprobantes cargados manualmente
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('subscription-receipts','subscription-receipts', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
```

### 3.2 Captura automática desde los gateways

| Archivo | Cambio |
|---|---|
| `src/app/api/paypal/webhook/route.ts` | Agregar rama `PAYMENT.SALE.COMPLETED` / `PAYMENT.SALE.REFUNDED`: `resource.billing_agreement_id` → busca `subscriptions.paypal_subscription_id`; inserta en `subscription_payments` con `gateway_payment_id = resource.id`, `amount = resource.amount.total`, `currency = resource.amount.currency`, `paid_at = resource.create_time`, `receipt_url = resource.links[rel=self]`. Refund → `status = 'refunded'`. Insert idempotente (`onConflict: 'gateway,gateway_payment_id'`, `ignoreDuplicates`). |
| `src/app/api/mercadopago/webhook/route.ts` | Aceptar `type = 'payment'` (hoy se descarta en la línea `if (body.type && body.type !== 'subscription_preapproval')`): `GET /v1/payments/{id}` → `transaction_amount`, `currency_id`, `date_approved`, `preapproval_id` para el match. Comprobante: `transaction_details.external_resource_url`. |
| `src/app/api/stripe/webhook/route.ts` | Rama `invoice.paid`: `amount_paid/100`, `currency`, `status_transitions.paid_at`, `receipt_url = invoice.invoice_pdf`. Queda inerte hasta que existan Price IDs reales (ver `docs/SUBSCRIPTION_GAP_ANALYSIS.md`), pero se construye una sola vez. |

**Dependencia de configuración (fuera del código):** en el panel de PayPal hay que suscribir el webhook a `PAYMENT.SALE.COMPLETED` y `PAYMENT.SALE.REFUNDED`; en MercadoPago, activar el tópico `payment`. Sin esto la rama nueva nunca se ejecuta.

### 3.3 Registro manual + comprobante (admin)

| Ruta | Función |
|---|---|
| `POST /api/admin/subscription-payments` | `multipart/form-data`. Campos: `influencer_id` \| `organization_id`, `amount`, `currency`, `paid_at`, `concept`, `payment_method`, `notes`, `file` (opcional, PDF/JPG/PNG/WebP ≤10 MB). Solo `isAdmin` vía `getUserRole`. Reutiliza el patrón exacto de `src/app/api/influencer/documents/route.ts` (validar → subir a Storage → insertar fila → rollback del archivo si falla el insert). |
| `GET /api/admin/subscription-payments?influencer_id=&organization_id=` | Historial para el panel admin. |
| `GET /api/admin/subscription-payments/[id]/receipt` | Devuelve URL firmada (60 s) del comprobante. Admin, o el dueño del pago. |
| `PATCH /api/influencers/[id]/pro` (existente) | Aceptar payload opcional `{ payment: { amount, currency, paid_at, payment_method, notes } }` al activar Pro manual → escribe la fila del ledger en la misma acción. **Activar y registrar el pago dejan de ser dos flujos separados.** |

### 3.4 Superficies de lectura

| Archivo | Cambio |
|---|---|
| `src/app/api/influencer/billing/route.ts` | Sumar `started_paying_at` y `payments[]` (propios) a la respuesta. |
| `src/app/api/brand/billing/route.ts` | Ídem para la organización. |
| `src/app/(dashboard)/admin-influencers/[id]/InfluencerProfile.tsx` | Bajo el badge `PLAN PRO` (línea ~493): "Paga desde {started_paying_at}", historial (fecha · monto · gateway · comprobante) y botón **Registrar pago** con carga de archivo. |
| `src/app/(influencer)/inf-plan/InfluencerPlanSettings.tsx` | Bloque "Mis pagos" con descarga del comprobante propio. |
| `src/app/(brand)/brand-billing` | Mismo historial, solo lectura. |

---

## 4. Riesgos y decisiones que hay que cerrar

1. **35 filas `incomplete`** (checkouts abandonados, hasta 4 por el mismo influencer) ensucian cualquier reporte de ingresos. No se borran en esta fase — el ledger las ignora porque solo registra pagos reales —, pero conviene una limpieza aparte, con el criterio de siempre: arreglar primero la causa (el checkout crea la fila antes de que exista pago), después limpiar datos.
2. **7 marcas con `subscription_plan_override`** tienen Pro sin ninguna fila de pago. Decisión comercial: ¿son cortesías, o pagos fuera de plataforma que hay que registrar retroactivamente?
3. **Moneda**: `currency_code` incluye USD y CLP. PayPal cobra en USD; un cobro por transferencia en Chile entra en CLP. El ledger guarda la moneda del cobro; cualquier MRR consolidado necesita definir tipo de cambio — no está en este alcance.
4. **Comprobante ≠ documento tributario.** El recibo de PayPal es respaldo de la transacción, no una boleta/factura chilena. Emitir el documento ante el SII es un circuito aparte que este plan no cubre; el ledger deja los datos listos para alimentarlo.

---

## 5. Backfill (correr antes del 7 de octubre)

1. Para las **7 suscripciones activas**: `UPDATE subscriptions SET started_paying_at = current_period_start WHERE status = 'active' AND started_paying_at IS NULL` — hoy el valor todavía es el inicio real; tras la primera renovación deja de serlo.
2. Reconstrucción exacta e histórica: script one-shot que recorre `GET /v1/billing/subscriptions/{id}/transactions` de PayPal por cada suscripción y llena `subscription_payments` con los cobros ya ocurridos (monto, transaction id, fecha). Es la única forma de recuperar el historial completo, y deja el ledger consistente desde el día 1.
3. **1 Pro manual** + las marcas con override: carga manual desde el panel, con comprobante si existe.

---

## 6. Verificación antes de aprobar el deploy

- `npm run build` sin errores de tipos.
- Webhook idempotente: reenviar el mismo `PAYMENT.SALE.COMPLETED` dos veces → 1 sola fila.
- `started_paying_at` no se mueve con el segundo pago ni con una renovación.
- RLS: influencer A no ve pagos de B; miembro de marca no ve pagos de otra organización.
- Sandbox PayPal: checkout completo → fila de suscripción **y** fila de pago con comprobante.
- Carga manual: archivo sube, URL firmada expira, insert fallido no deja archivo huérfano.

---

## 7. Esfuerzo estimado

| Fase | Alcance | Tiempo |
|---|---|---|
| 1 | Migración + trigger + RLS + bucket | 2 h |
| 2 | PayPal `PAYMENT.SALE.*` + backfill de las 7 activas | 3 h |
| 3 | API admin de registro manual + comprobante | 3 h |
| 4 | UI admin, influencer y marca | 4 h |
| 5 | MercadoPago + Stripe (dormido hasta tener Price IDs) | 2 h |

**Ruta crítica para poder responder "desde cuándo paga y con qué respaldo": fases 1 + 2 (5 h).**
