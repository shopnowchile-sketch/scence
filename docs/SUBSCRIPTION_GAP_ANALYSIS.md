# Suscripción paga — gaps y plan de migración

_Auditado 2026-07-03. Datos verificados en producción (Supabase)._

## Estado actual (verificado, no supuesto)

- 3 planes activos en `subscription_plans`: Starter $59.990 · Plus $119.990 · Enterprise $249.990 (CLP/mes).
- `stripe_price_id_monthly` = `NULL` en los 3 → el checkout de Stripe existe en código (`/api/stripe/checkout`, `/api/stripe/webhook`) pero **no puede cobrar nada real** hoy.
- `max_influencers` / `max_campaigns` = `NULL` en los 3 planes activos → aunque alguien pagara, **no hay ningún límite ni feature distinto entre Starter/Plus/Enterprise**. Los 3 dan lo mismo.
- 0 filas en `subscriptions` → ninguna de las 32 organizaciones / 25 marcas está suscrita a nada todavía.
- `middleware.ts` no consulta `subscriptions` en ningún punto → aunque existiera una suscripción vencida, **nada bloquea el acceso**.
- UI `/brand-billing` ya está construida (pricing cards estilo Montu), pero es solo vitrina — no hay botón de upgrade conectado a Stripe todavía verificado en vivo.

**Conclusión:** la base de datos y el checkout están armados (~40% del camino), pero cobrar de verdad y diferenciar planes está en 0%.

## Gaps, en orden de prioridad para monetizar

1. **Crear los Price IDs reales en Stripe** y pegarlos en `stripe_price_id_monthly/yearly` de los 3 planes. Sin esto nada de lo demás sirve. (Bloqueante #1.)
2. **Definir límites reales por plan** (influencers activos, campañas simultáneas, usuarios del equipo) y llenarlos en `max_influencers`/`max_campaigns`/`max_users`. Hoy están vacíos.
3. **Enforcement server-side de los límites** — al crear campaña/influencer/usuario, chequear el plan de la marca contra su uso actual antes de permitir. Sin esto los límites de la tabla son decorativos.
4. **Gate de acceso por estado de suscripción** — si `subscriptions.status` = `past_due`/`canceled`, degradar a solo-lectura (patrón Montu: no borra data, bloquea acciones). Se agrega en `middleware.ts` o en cada API mutante, reutilizando `getOrgSubscription()` que ya existe en `subscription-plans.ts`.
5. **Webhook de Stripe robusto** — confirmar que `checkout.session.completed`, `invoice.payment_failed` y `customer.subscription.deleted` actualizan `subscriptions.status` correctamente (revisar, no reconstruir — el endpoint ya existe).
6. **Trial / plan gratuito de entrada** — Montu usa 14 días gratis antes de pedir tarjeta. Definir si SCENCE hace lo mismo o cobra desde el día 1 (afecta conversión).
7. **Métricas de billing en el dashboard admin** — ya existe `revenue_month`/`payroll_month` en `/api/dashboard`; falta MRR real (suma de `subscriptions` activas) una vez haya suscriptores de verdad.

## Plan de migración (mínimo viable, en fases)

**Fase 1 — Activar cobro real (1-2 días de trabajo técnico)**
Crear productos/precios en Stripe → pegar IDs en `subscription_plans` → probar 1 checkout end-to-end con tarjeta de prueba → confirmar que el webhook escribe en `subscriptions`.

**Fase 2 — Diferenciar planes (medio día)**
Definir números de negocio (cuántos influencers/campañas por tier) → actualizar `max_*` en los 3 planes → agregar el chequeo de límite en los endpoints de creación (`POST /api/campaigns`, `POST /api/influencers`, invitar usuario).

**Fase 3 — Enforcement de acceso (medio día)**
Middleware o wrapper de API que lea `getOrgSubscription()` y bloquee mutaciones si `status` no es `active`/`trialing`. Portal Influencer no se toca — esto es solo para Marca/Admin de agencia.

**Fase 4 — Migrar orgs existentes (1 día, requiere tu decisión de negocio)**
Las 32 organizaciones actuales no tienen suscripción. Decidir: ¿se les da un plan gratis retroactivo, un trial, o se les pide pagar para seguir? Esto es 100% decisión comercial tuya, no técnica — avisar antes de tocar cualquier org existente (regla de "no tocar billing sin aprobación").

## Lo que NO hace falta construir de nuevo

Checkout, webhook, tabla de planes, UI de pricing y `getOrgSubscription()` ya existen y están razonablemente bien hechos — el trabajo real es **conectar y hacer cumplir**, no reconstruir.
