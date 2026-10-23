# Portal de influencers: cómo obtiene su propia ficha y solución mínima — 2026-10-22

Alcance: lectura de código (sin ejecutar contra producción). Estado: DIAGNÓSTICO; no se añade política RLS ni se amplían permisos.

## Cómo verifica la identidad
Todas las rutas `/api/influencer/*` auditadas y el layout `(influencer)` hacen: sesión (`auth.getUser()`) → cliente service_role → `influencers ... .eq('user_id', user.id)` → el resto de consultas filtra por `influencer.id` obtenido así. Ningún `id` de ficha llega del cliente. El navegador no consulta `influencers` ni tablas comerciales con su sesión (solo `profiles`/`organizations` en el sidebar y signOut). RLS no participa en el portal.

## Endpoints (campos que devuelven)
| Endpoint | Verificación | Campos devueltos | Observación sensible |
|---|---|---|---|
| `GET /api/influencer/me` | `user_id = sesión` (`.single()`) | id, display_name, avatar_url, bio, email, phone, address, location_id, birth_date, categories, tags, is_verified, **organization_id**, perfiles sociales (id, platform, username, followers, engagement_rate, profile_url, synced_at, sync_status) + ubicación oficial + referred_brands_count | Datos propios. `organization_id` es identificador interno de tenant que el portal no usa → quitar de la respuesta. |
| `GET /api/influencer/billing` | `user_id`, pagos por `influencer_id` | suscripción (id, status, periodos, `paypal_subscription_id`, **metadata**, plan), pagos (id, gateway, `gateway_payment_id`, método, monto, estado, fechas, receipt_url), flags Pro | `metadata` y IDs de pasarela son internos → devolver lista blanca. |
| `GET /api/influencer/payments` | `user_id` | payroll_items propios (monto, estado, `payment_reference`, descripción, run y campaña) | Solo lo propio. |
| `GET/POST /api/influencer/affiliate` | `user_id` | link propio (code, full_link, clicks, conversions, revenue) | Solo lo propio. |
| `GET/POST /api/influencer/documents` | `user_id` | metadatos de sus documentos (tipo, título, nombre, mime, tamaño, visibilidad) | No devuelve la ruta de storage. |
| `GET /api/influencer/bookings`, `my-campaigns` | `user_id` + `influencer_id` | bookings y campañas donde participa | Revisar que no filtre datos de marca no destinados a la influencer (no revisado campo a campo). |
| avatar, terms, campaigns/*, deliverables/*, paypal/*, account/deactivate, subscription-payments/[id]/pdf | derivan `influencer` por `user_id` (verificado por patrón en el código) | NO revisados campo a campo | **Por verificar.** |

## Recomendación mínima (sin RLS nueva sobre `influencers`)
1. **No añadir `influencers_self_read` ahora.** Nada del portal lo necesita y expondría todas las columnas de la fila.
2. Endurecer las respuestas (cambio de código pequeño, NO realizado, requiere aprobación): quitar `organization_id` de `GET /me`; en `GET /billing` devolver lista blanca de la suscripción (sin `metadata` ni `paypal_subscription_id` si la UI no los usa).
3. Si en el futuro se necesita lectura directa por PostgREST/RLS: (a) función `SECURITY DEFINER` `public.my_influencer_id()` (STABLE, `search_path` fijo, devuelve solo el id de la ficha del `auth.uid()`), usada por las 10 políticas «propias» en vez de la subconsulta a `influencers`; y (b) si hace falta leer la ficha, una vista `SECURITY INVOKER` con columnas permitidas (`where user_id = auth.uid()`), sin política sobre la tabla base. Así no se hace miembro de ninguna organización ni ve otras fichas ni columnas internas.
4. Prueba local previa a cualquier migración: la influencer ve solo su fila, ninguna ajena, no escribe y `anon` queda en 0 (como ya hace `scripts/test-rls-influencers-local.mjs` para la política completa).

## Qué NO se hizo
No se crearon políticas, vistas ni funciones; no se tocaron rutas del portal.
