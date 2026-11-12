# Optimización y errores de guardado — 2026-11-12

Alcance: fase 2 (puntos 6-7) y fase 4. Sin commit, push, migración ni deploy. Producción (`xzzbishzfyovrladcaeb`): solo conteos agregados y catálogo. DEV (`dexpvoubiklgotuukrml`): solo SELECT/EXPLAIN.
Verificación final: `npx tsc --noEmit` sin errores; `npx next lint` 0 errores (advertencias previas ajenas); `npm test` 947 pruebas, 944 pasan, 0 fallan, 3 `todo` previos.

## 1. Cambios hechos

### A. Errores de guardado (se ignoraba `error` de una escritura → «éxito» sin guardar o pérdida de datos)

| Archivo | Qué pasaba | Cambio mínimo | Prueba |
|---|---|---|---|
| `src/app/api/influencer/me/route.ts` (PATCH) | Perfil de influencer: update/insert/delete de redes sociales sin revisar `error`. Si fallaba el @ nuevo, respondía 200 y la persona creía haberlo guardado. | Cada escritura revisa `error` y responde 500 con mensaje genérico (sin error técnico). Sin cambios si todo sale bien. | `tests/save-errors-not-swallowed.test.ts` (4: update, insert, delete fallidos y camino feliz) |
| `src/app/api/influencers/merge/route.ts` | Al combinar fichas, si fallaba copiar email/teléfono/etc. al registro principal, o mover una red social, igual se ejecutaba `hardDeleteInfluencers` sobre los donantes: el dato se perdía para siempre. | Si falla cualquiera de esas dos escrituras se aborta con 500 **antes** de borrar. | 2 pruebas (el donante y su red social siguen existiendo) |
| `src/app/api/admin/collaboration-applications/[id]/route.ts` | «Rechazar» respondía `success` aunque el UPDATE fallara; «aprobar para pago» creaba la factura borrador y, si fallaba el UPDATE de la solicitud, seguía en pendiente sin avisar (reintento = factura duplicada). | Revisa `error`; en aprobar devuelve 500 con el `invoice_id` ya creado. No toca montos ni permisos. | 2 pruebas (reject fallido → 500 y estado intacto; reject ok → 200) |
| `src/app/api/campaigns/[id]/attendance-confirmations/route.ts` | La lectura previa de confirmaciones existentes ignoraba `error`: si fallaba, todas parecían «sin fila» y se insertaban confirmaciones duplicadas. Tampoco se revisaba el guardado de la plantilla para las próximas aprobadas. | Revisa ambos `error` y responde 500. | Prueba estática (la ruta exige muchas dependencias) |
| `src/app/api/bookings/route.ts` (POST) | El `insert` en `booking_influencers` iba en `try/catch` pero supabase-js no lanza: un fallo dejaba la reserva sin sus influencers sin ningún rastro. | Captura `error`, lo registra y responde 201 con `warning` (campo adicional, la reserva sí se creó). | Prueba estática |

Revisadas y **correctas** (escriben solo lo que llega en el cuerpo, revisan `error`): `api/influencers/[id]` PUT/PATCH (lista blanca `pickAdminInfluencerColumns` + metadata mezclada), `api/campaigns/[id]` PUT/PATCH, `api/brand/campaigns/[id]` PATCH (la dirección solo se toca con `'address' in body`), `api/brands/[id]` PATCH (`key in rest`), `api/brand/me` (ya usa `brand-profile-update.ts`), `api/influencer/me` campos de perfil (`key in body`). Los `|| null`/`?? null` restantes que se revisaron están en rutas de **creación** (contratos, CRM, conversión de lead), donde `null` es el valor correcto.

### B. Rendimiento (mismo resultado, menos esperas)

Causa común: tandas `.in(...)` de 200 ids y recorridos del roster completo (≈3.170 influencers en PROD) hechos **de a uno**, y lecturas independientes en serie.

| Archivo | Cambio |
|---|---|
| `src/lib/supabase/fetchAllRows.ts` | Nuevo helper `mapInBatches(items, size, worker, concurrency = 4)`: tandas en paralelo (máx. 4), resultados en orden. Reutiliza el archivo existente; sin dependencias. |
| `src/lib/supabase/lastSeen.ts` | `resolveLastSeen`: las tandas de `profiles` en paralelo (antes 15 secuenciales para 2.862 usuarios). Lógica de respaldo `auth.users` intacta. |
| `src/lib/influencer-pro.ts` | `getInfluencerProStatuses` y `getInfluencerProSubscriptionDetails`: tandas en paralelo (antes 16 secuenciales). Mismo resolver, mismo resultado. |
| `src/app/api/dashboard/route.ts` | (1) El roster se lee **una vez** (`id, user_id`) en lugar de dos recorridos completos; (2) suscripciones Pro y cobros se lanzan en el `Promise.all` inicial (antes iban al final, en serie); (3) estado Pro corre en paralelo con «última conexión». Sin cambios de resultado. |
| `src/app/api/influencers/route.ts` | Las 5 lecturas de enriquecimiento de la página (última conexión, marcas asignadas, marcas de la org, plan Pro, detalle de suscripción) en un único `Promise.all`. |
| `src/app/api/campaigns/route.ts` | **Corrección con cambio de cifra** (no es rendimiento): el KPI `summary=1` «Deliverables pend.» seleccionaba solo `status/content_url/published_url`, sin `type` ni `attendance_response`, que exige `isDeliverableComplete` (CLAUDE.md §16.14). Una asistencia **declinada** contaba como pendiente en el KPI pero como completa en la tabla. Ahora selecciona ambos campos. Impacto estimado en PROD (conteo agregado de aceptadas): −23 pendientes (asistencias declinadas con respuesta); las 29 vencidas sin respuesta siguen pendientes. |

Pruebas: `tests/batched-parallel-queries.test.ts` (8): `mapInBatches` (orden, tamaño, concurrencia máx.), `getInfluencerProStatuses` y `…SubscriptionDetails` con roster de varias tandas, `resolveLastSeen` con respaldo en varias tandas, **handler real** de `/api/dashboard` (entered/pending y embudo Pro con 500 influencers), y pruebas estáticas de la estructura del dashboard, del listado y del select del KPI.

### C. Código muerto

Barrido de archivos (`src/`) sin ninguna referencia en `src/tests/scripts`: **ninguno**. Exportaciones sin referencias externas: solo `computeEngagementRate` en `src/lib/deliverables/apify-metrics.ts` (envoltorio de 3 líneas sobre `computeEngagementRateDetails`, con la documentación de la fórmula). **No se eliminó**: el ahorro es nulo y perdería el comentario. Candidato si se quiere limpiar.

## 2. Mediciones antes/después

Método (honesto sobre sus límites): no se puede llamar a las rutas autenticadas, y DEV tiene solo 153 influencers, así que se ejecutaron los **handlers reales** (`GET /api/dashboard`, `GET /api/influencers`) y las funciones reales sobre una base en memoria con **escala PROD** (3.170 influencers, 2.862 con usuario, 1.101 ubicaciones, 170 suscripciones; cifras de `count(*)` agregado) y una **latencia simulada por consulta** (30/60/120 ms). «Antes» = copia del árbol con las versiones originales de los 5 archivos. Resultados idénticos antes/después (misma salida en cada caso). Mide la orquestación (idas y vueltas), no el tiempo de Postgres ni de red reales. Scripts en el scratchpad de la sesión, fuera del repositorio.

| Caso (escala PROD) | Latencia/consulta | Antes | Después |
|---|---|---|---|
| `GET /api/dashboard` | 30 ms | 1.590 ms | 468 ms |
| | 60 ms | 2.930 ms | 892 ms |
| | 120 ms | 5.690 ms | 1.697 ms |
| `GET /api/influencers?limit=100` (listado admin) | 60 ms | 892 ms | 636 ms |
| `GET /api/influencers?limit=5000&sort_by=followers` (AddInfluencerClient) | 60 ms | 4.084 ms | 1.199 ms |
| | 120 ms | 7.836 ms | 2.285 ms |
| `resolveLastSeen` (2.862 user_id) | 60 ms | 1.138 ms | 469 ms |
| `getInfluencerProStatuses` (3.170 ids) | 60 ms | 1.034 ms | 314 ms |
| `getInfluencerProSubscriptionDetails` (3.170 ids) | 60 ms | 980 ms | 252 ms |

Consultas y filas por request (contadas en la ejecución):

| Ruta | Consultas antes → después | Filas leídas antes → después | Máx. en paralelo |
|---|---|---|---|
| `/api/dashboard` | 74 → 71 | 12.568 → 9.706 (−2.862: roster leído una vez) | 13 → 15 |
| `/api/influencers?limit=100` | 15 → 15 | 1.475 → 1.475 | 2 → 6 |
| `/api/influencers?limit=5000…` | 79 → 79 | 10.687 → 10.687 | 2 → 18 |

El número de consultas casi no cambia: lo que baja es la **ruta crítica** (en el dashboard, de ~45 idas y vueltas secuenciales a ~12, estimado leyendo el código; el tiempo medido arriba lo confirma). Contrapartida: más conexiones simultáneas a PostgREST (tope 4 tandas por función; hasta ~18 consultas en vuelo en el caso más pesado), que se encolan en el pool sin fallar.

EXPLAIN (ANALYZE, BUFFERS) sobre DEV (153 influencers) de las consultas equivalentes: roster `id,user_id` por org (index scan `idx_influencers_org`, 0,26 ms), `profiles` por lote (index scan `profiles_pkey`, 0,64 ms), `subscriptions` por `metadata->>'influencer_id'` (Seq Scan, 0,40 ms), entregables de aceptadas con join (0,35 ms). Con ese volumen no discrimina: la base **no** es el cuello; lo es el número de idas y vueltas.

## 3. Hallazgos pendientes (no corregidos) y propuesta

### Guardado (A)
1. **Espejo en `organizations` sin revisar error**: `api/brand/logo`, `api/brands/[id]/logo`, `api/influencer/owned-brands/[id]` PATCH (`organizations.logo_url/name`). Si falla, marca y organización quedan con logo/nombre distintos. Propuesta: revisar `error` y devolver 500 (cambio de 1 línea por ruta; no se hizo por tocar el modelo marca↔organización).
2. **`api/influencers/merge` paso 4** (reasignar `campaign_influencers`/`campaign_deliverables` «best-effort; conflictos se ignoran») y luego borrado en cascada: ante un conflicto único, las participaciones/entregables del donante se pierden. Requiere decisión de negocio (¿fusionar filas duplicadas?) → no tocado (datos históricos).
3. Sin revisar `error`: `api/campaigns/[id]/duplicate` (borrados de compensación y `insert` de `campaign_brands`), `api/campaigns/[id]/barters` (borrados de compensación y notificación), rollback de `deliverable_templates` en `campaigns/[id]` PUT/PATCH y `brand/campaigns/[id]`, rollback de reinstalación en `campaigns/[id]/influencers`, `api/affiliates/settlements` (delete), `api/crm-leads/[id]` (`converted_brand_id` línea ~321 y actividades), `api/influencers` POST (`affiliate_links`), `api/settings/team/invite` (`profiles.insert`), `api/support` (`ai_review`), `api/brands/[id]` (limpieza de `pending_collab_campaign_id`), `api/brand/documents/[id]` (notificación a admins). Casi todos son bitácoras o compensaciones; propuesta: al menos `console.error` y, en conversión de lead y duplicación, 500.
4. **`api/unsubscribe`**: `crm_leads.update({ marketing_consent: true })` y actividades sin revisar `error` (cumplimiento de consentimiento) → conviene revisarlo con prioridad.
5. **`api/bookings` PUT** esparce `...rest` del cuerpo en el UPDATE (sin lista blanca de columnas; `campaign_id/organization_id/created_by` sí se excluyen). Es de permisos/propiedad → solo documentado; propuesta: lista blanca como `pickAdminInfluencerColumns`.
6. `api/influencer/me` PATCH: el perfil se guarda antes que las redes; si fallan las redes el resto ya quedó guardado (ahora se avisa con 500, pero no es transaccional). Propuesta: aceptable; el formulario reintenta.

### Rendimiento (B)
1. **`getOfficialLocationDisplayMap` / `loadLocationRows`** lee todo el catálogo `locations` (1.101 filas en PROD) en **5 páginas secuenciales de 250** en cada request de listado/detalle/me de influencers (≈300 ms a 60 ms/consulta). `pageSize: 250` está fijado por `tests/phone-address.test.ts` y por el tope de filas de DEV (500). Propuesta: caché en memoria del proceso con TTL corto (el catálogo cambia muy poco) o leerlo con `mapInBatches` por rangos; requiere decidir el tope de filas por entorno.
2. **`AddInfluencerClient`** (`limit=5000&sort_by=followers`): fuerza el dataset completo con el SELECT pesado (bio, metadata, rate cards, redes) y enriquece 3.170 filas (≈10.700 filas leídas, 79 consultas). Mejorado ×3,4 en espera, pero sigue cargando todo el roster al cliente. Propuesta: paginación/búsqueda en servidor (el listado ya soporta `page`, `limit`, `search`); la búsqueda por @ de redes exigiría añadirla a `search_text`; cambio de UX → no hecho.
3. `/api/campaigns`: las rutas `summary=1` y listado releen entregables por separado (dos requests de la misma pantalla). Propuesta: derivar el KPI de pendientes del listado ya cargado cuando ≤ 1 página; o devolver el KPI en la misma respuesta. Además `campaignMetrics` recorre `cdRows.filter(...)` por campaña completada (O(N·M), irrelevante hoy: 20 campañas × 1.262 filas) y la columna `performance` (JSON) se descarga para todas las campañas aunque solo se usa en las completadas.
4. `summary=1` arma `.in('campaign_id', ids)` con hasta 5.000 ids en la URL: hoy 20 campañas, pero rompería el largo de URL de PostgREST con cientos. Propuesta: filtrar por `campaigns!inner` o por lotes.
5. `/api/influencers`: la lectura de `subscriptions` incompletas va en serie antes de la consulta principal (1 ida y vuelta); `getOrgId` + `getUserRole` en serie al inicio de cada ruta.
6. **Índices** (catálogo PROD): `subscriptions` no tiene índice por `organization_id` ni por `(metadata->>'influencer_id')`; con 170 filas es irrelevante, pero crecerá. Propuesta de migración (no creada, requiere autorización): índice por expresión sobre `metadata->>'influencer_id'` y por `organization_id`.
7. `/api/dashboard`: `getInfluencerProStatuses` sigue recorriendo todo el roster (16 tandas, ahora en paralelo). Propuesta a futuro: contar Pro con una consulta agregada/RPC en vez de por influencer.

### Código muerto (C)
`computeEngagementRate` (ver arriba). Sin otros candidatos evidentes.

## 4. Archivos modificados por este paquete

`src/app/api/influencer/me/route.ts`, `src/app/api/influencers/merge/route.ts`, `src/app/api/admin/collaboration-applications/[id]/route.ts`, `src/app/api/campaigns/[id]/attendance-confirmations/route.ts`, `src/app/api/bookings/route.ts`, `src/app/api/dashboard/route.ts`, `src/app/api/influencers/route.ts`, `src/app/api/campaigns/route.ts`, `src/lib/supabase/fetchAllRows.ts`, `src/lib/supabase/lastSeen.ts`, `src/lib/influencer-pro.ts`; pruebas nuevas `tests/save-errors-not-swallowed.test.ts` y `tests/batched-parallel-queries.test.ts`. Varios de estos archivos ya tenían cambios ajenos sin commit (p. ej. `campaigns/route.ts`, `dashboard/route.ts`); las ediciones fueron puntuales.
