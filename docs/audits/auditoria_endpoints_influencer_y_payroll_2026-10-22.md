# Auditoría campo por campo: endpoints `/api/influencer/*` pendientes y `POST /api/payroll` — 2026-10-22

Método: lectura completa del código de cada ruta (no ejecución contra producción). Todas usan service_role; la protección real es la comprobación por ruta.

## Endpoints de influencer
| Ruta | Autorización | Datos devueltos | Resultado |
|---|---|---|---|
| `POST avatar` | `user_id` de la sesión → ficha propia; sube a `{influencer.id}/…`; solo borra imágenes antiguas bajo su propio prefijo | `avatar_url` | OK. Menor: devuelve `uploadError.message` de Storage. |
| `GET/POST terms` | ficha por `user_id`; filtra por `influencer_id` | aceptaciones propias (incl. `content_snapshot`, `document_*`) + nombre | OK. Menor: sin ficha responde 401 (debería ser 403). Sin cambio. |
| `GET campaigns` | ficha por `user_id`; `influencer_id` propio | campañas propias con `budget_total`, `deliverable_templates`, marca (id, name, logo, instagram) | OK. `budget_total` no lo usa la UI de lista, pero `GET campaigns/[id]` lo expone por regla de negocio declarada («presupuesto/remuneración visibles»): sin cambio. |
| `GET campaigns/open` | ficha por `user_id` | marketplace activo | **DEFECTO CORREGIDO**: devolvía `campaign_influencers` (id y estado de postulaciones de OTRAS influencers). Ahora solo `accepted_count`. |
| `GET campaigns/[id]` | ficha por `user_id`; DTO público hasta `accepted` (oculta brief, marcas colaboradoras, dirección) | campaña + booking redactado | OK. |
| `POST/DELETE/PATCH campaigns/[id]/apply` | ficha por `user_id`; DELETE/PATCH acotan a su propia fila y `origin`; Pro y términos para privadas | ids | OK. Pendiente de criterio: `message` sin límite de longitud (no se demuestra daño). |
| `GET campaigns/[id]/barters` | ficha por `user_id`; solo sus canjes; auto-crea fila si es aceptada | canje propio, beneficios, historial | OK. (Un GET que escribe, ya documentado en el código.) |
| `GET campaigns/[id]/report` | ficha por `user_id`; exige `accepted` | campaña, marca (contacto), sus entregables | OK. |
| `POST deliverables/[id]/attendance` | ficha por `user_id`; `deliverable.influencer_id` propio; exige `accepted` | respuesta de asistencia | OK. Menor: devuelve `error.message` de BD. |
| `POST deliverables/[id]/submit` | ficha por `user_id`; propiedad del entregable; `accepted`; campaña no borrador | fila de su entregable | **DEFECTO CORREGIDO**: el correo a operaciones interpolaba sin escapar nombre, título, campaña y URL (la URL, sin validar, podía ser `javascript:`/HTML) → inyección HTML en la bandeja de administración. Ahora se escapa y solo `http(s)` se enlaza. Asunto sin saltos de línea. No cambia reglas de negocio. |
| `POST paypal/checkout` | ficha activa por `user_id`; `campaign_id` validado contra su relación aceptada | URL de aprobación | OK. Menor: reenvía `message` de PayPal. |
| `POST paypal/complete` | ficha por `user_id`; verifica en PayPal que `custom_id` pertenece a SU ficha | `{plan:'pro'}` | OK. |
| `POST paypal/cancel` | ficha por `user_id`; suscripción por `metadata.influencer_id` propia | estado de cancelación | OK. |
| `POST account/deactivate` | ficha por `user_id`; bloquea si hay compromiso | `{deactivated}` | OK. |
| `GET subscription-payments/[id]/pdf` | pago filtrado por `id` Y `influencer_id` propio | PDF propio (incluye ID de pasarela, normal en un comprobante) | OK. |
| `GET /me`, `GET /billing` | ficha por `user_id` | ver recorte | **CORREGIDO**: `/me` sin `organization_id`; `/billing` con lista explícita (ver `auditoria_portal_influencer_ficha_propia`). Consumidores confirmados: login, sidebar, dashboard, perfil, plan. |

## `POST /api/payroll` (SIN cambios de código: requiere aprobación)
Hecho: tras el cambio local, solo `isPlatformAdmin` puede llamar. Riesgos que persisten:
1. **`organization_id` del cuerpo** (`const orgId = organization_id ?? getOrgId(...)`): un administrador (o una petición manipulada) puede crear una nómina en CUALQUIER organización. GET y PATCH solo operan sobre la organización propia del administrador (`getOrgId`), así que esa nómina queda invisible e inmanejable (huérfana). La UI (`BillingClient`) nunca envía `organization_id`. Corrección propuesta: ignorar el campo del cuerpo y usar siempre `getOrgId`; si se quiere permitir otra organización, validarla contra una lista explícita.
2. **Importes sin validar**: `amount` puede ser negativo, no numérico (concatena cadenas en la suma) o NaN; la UI ya filtra `amount > 0`. Propuesta: exigir número finito > 0 y `influencer_id` string no vacío; `currency` en lista permitida.
3. **No atómico**: crea la corrida y luego los ítems; si fallan los ítems intenta borrar la corrida (puede quedar huérfana si ese borrado falla). Propuesta: función SQL transaccional.
4. **Sin idempotencia**: un doble envío crea dos corridas. Propuesta: clave de idempotencia o control en la UI.
5. El orden de comprobaciones responde 400 (organización) antes de 403 (permiso). Propuesta: autorizar primero.
Pruebas de la política propuesta quedan como `todo` en `tests/payroll-bookings-access.test.ts` (no cuentan como aprobadas).

## Pendiente / no demostrado
Longitud/contenido de `apply.message`; mensajes de error de BD/Storage/PayPal reenviados al cliente; `terms` 401 vs 403. No se cambian sin tu aprobación.
