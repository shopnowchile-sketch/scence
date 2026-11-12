# Auditoría de estandarización de SCENCE — 2026-11-12

Solo lectura sobre producción (`xzzbishzfyovrladcaeb`, conteos agregados, sin datos personales) y lectura del código local. Sin migraciones, sin borrados, sin cambios en RLS, Auth, pagos, contratos ni suscripciones. Cifras de producción en vivo: pueden moverse unas filas.

## Resumen ejecutivo

- SCENCE es consistente en lo esencial: sin huérfanos en FKs revisadas (entregables↔participantes, pagos↔suscripciones, locations↔padres), sin emails duplicados en influencers ni en CRM, y el KPI de entregables usa una sola lógica (`deliverable-status.ts`).
- Las duplicaciones reales se agrupan en **cinco causas**: (A) dos columnas de estado de participación, (B) ubicación guardada como texto y como `location_id`, (C) columnas con 0 datos y 0 uso en código, (D) `published_url` vs `content_url` en entregables, (E) fechas de decisión que no siempre se guardan.
- El hallazgo con más impacto visible: **los totales de entregables del listado de campañas (Admin) incluyen los de participantes rechazadas** (119 entregables, 115 «pendientes»). Corrección lista, falta probarla con sesión.
- El de más riesgo de privacidad: **la vista de marca del detalle de campaña devuelve `campaign_influencers[].notes`, `metadata` y datos de contacto de marcas colaboradoras**. Necesita decisión (regla cero).
- Ya corregido en esta jornada: notas internas de marcas (solo Admin), PayPal ya no reactiva suspendidas, aviso de marca suspendida, direcciones con Google Maps, `rejected_at` al rechazar una invitación.
- `budget_spent` vale 0 en las 20 campañas: «Gastado» del panel siempre muestra 0.
- Hay una migración sin aplicar (`20261110230000_drop_unused_influencer_columns.sql`, de otro trabajo) que elimina 10 columnas de `influencers`, incluida `is_verified` y `portal_invite_sent_at` (319 fechas). Ya prevé trasladar las fechas a `metadata`; revisar antes de aplicar.
- Orden recomendado: 1) KPI de entregables, 2) visibilidad en vista de marca, 3) fechas de decisión, 4) retiro de columnas muertas, 5) ubicación única, 6) estado de participación.

## Tabla de hallazgos (agrupados por causa)

| Módulo | Problema | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|
| Campaigns / KPI | `GET /api/campaigns` (resumen y listado) cuenta entregables de participantes **rechazadas** (119; 115 pendientes) mientras los participantes sí se cuentan solo aceptados. Infla «pendientes» y totales por campaña. | Traer entregables con `campaign_influencers!inner(application_status)` y filtrar `accepted`, en las dos consultas de `src/app/api/campaigns/route.ts`. Prueba con base en memoria. | Medio: cambia cifras visibles en Admin | Alta | Listo para corregir |
| Campaigns / permisos | La vista de marca de `GET /api/campaigns/[id]` incluye `campaign_influencers.notes`, `metadata` y `fee`, y `brand.contact_*` de marcas colaboradoras; `*` también trae `campaigns.internal_notes`. | Lista explícita de columnas para la vista de marca (reutilizar `scrubCampaignInfluencers`) y solo nombre/logo de colaboradoras. | Medio: toca visibilidad (regla cero) | Alta | Necesita decisión |
| Applications | `accepted_at` nulo en 226 aceptadas y `rejected_at` nulo en 557 rechazadas. La ruta de rechazo de invitación no guardaba fecha. | Ruta corregida (`apply/route.ts`). Rellenar histórico = cambio de datos. | Bajo | Media | Corregido (código) · Necesita decisión (histórico) |
| Applications | `campaign_influencers.status` (enum de campaña) duplica `application_status`: 46 `draft/accepted`, 21 `canceled/rejected`, 1 `active/rejected`. CLAUDE.md §16.1 ya prohíbe escribirla. El CHECK de `application_status` permite también `expired` y `withdrawn` (CLAUDE.md lista solo 3). | Dejar de leer `status` en consumidores (40 archivos mencionan `.status` junto a la tabla: auditar uno a uno) y luego retirarla. Actualizar CLAUDE.md con los 5 valores. | Alto si se retira sin auditar | Media | Necesita decisión |
| Deliverables | `published_url` está 100 % nula (32 archivos la mencionan); el dato real vive en `content_url` (232 filas). `caption`, `hashtags`, `platform` también 100 % nulas. | Una sola columna (`content_url`); retirar las otras tras revisar los 32 archivos. | Medio | Media | Necesita decisión |
| Deliverables | 4 entregables `approved` pertenecen a participantes rechazadas; 219 `approved` sin respuesta de asistencia (legado documentado en §16.14). | No tocar el legado. Los 4 casos: revisar a mano. | Bajo | Baja | Conservar como está · revisar 4 |
| Influencers / Locations | Texto (`city`, `commune`, `country`, `address`) coexiste con `location_id`: 762 tienen `location_id` y ningún texto; 1 260 ambos. 729 apuntan solo a país y 121 solo a región (precisión baja). 286 sin ubicación. | `location_id` como única fuente; derivar texto con `location_breadcrumb()`. Pedir comuna a quienes solo tienen país (campaña de datos, no de código). | Medio | Media | Necesita decisión |
| Influencers | Columnas 100 % nulas y sin uso en código: `age_range`, `audience_age_range`, `audience_gender_split`, `audience_countries`, `cover_url`, `gender`, `whatsapp`, `address_lat/lng`. | La migración local ya pendiente las retira (8 de 9). Falta `gender` y `address_lat/lng` (7 archivos mencionan lat/lng). | Bajo | Media | Listo para corregir (con aprobación de migración) |
| Influencers / Profiles | `profiles.avatar_url` y `onboarded_at` 100 % nulas (`onboarded_at`: 0 usos). `profiles.phone` 99,8 % nulo frente a `influencers.phone`. 294 nombres distintos entre ambas tablas (esperable: nombre público vs. legal). `profiles.role` solo presentación (§16.2). | Retirar `onboarded_at` y `avatar_url`; conservar nombres y `role`. | Bajo | Baja | Listo para corregir |
| Profiles | 102 `profiles` sin influencer ni membresía de organización. | Identificar origen (registros incompletos o cuentas de prueba) antes de decidir. | Medio | Media | Necesita decisión |
| Influencers | 308 influencers sin `user_id` (importadas) y 269 sin perfiles sociales (seguidores = 0 en rankings). | Conservar; mostrar «sin redes» en vez de 0. | Bajo | Baja | Conservar como está |
| Campaigns | `budget_spent` = 0 en las 20 campañas: el KPI «Gastado» no refleja nada. `address`, `do_follow_links`, `sorteo_winner`, `internal_notes` 100 % nulas (la dirección vive en `metadata.address`). `tags` constante; coexiste con `social_tags`, `hashtags`, `mention_handles`. | Calcular «Gastado» desde facturas/pagos o quitar la tarjeta. Retirar columnas muertas (0 usos: `do_follow_links`, `sorteo_winner`). | Medio (KPI visible) | Media | Necesita decisión |
| Campaigns | 1 campaña sin `brand_id`; `created_by_brand_id` nulo en 17 de 20 (esperado: solo campañas creadas por marcas). | Revisar la campaña sin marca. | Bajo | Baja | Listo para corregir (dato) |
| Bookings | 12 reservas: 8 `proposed`, 4 `confirmed` pero con `confirmation_status = pending` y `confirmed_at` nulo. 8 usan solo texto `location` (sin `location_id`). `influencer_id`, `confirmation_token`, `email_sent_at`, `fee`, `travel_budget` 100 % nulos. | Definir si la confirmación existe como proceso; si sí, sincronizar `confirmation_status`; si no, retirar campos. Ubicación: usar `location_id` (§16.11). | Bajo (8 filas) | Baja | Necesita decisión |
| Subscriptions | 143 de 170 suscripciones `incomplete` (checkout iniciado sin pago): ruido en cualquier conteo. 1 `active` con período vencido. `trial_ends_at` 100 % nula (0 usos). El chequeo «>1 activa por org» no sirve: casi todas cuelgan de una organización de agencia. | Verificar la vencida contra PayPal (solo lectura); excluir `incomplete` de métricas. No tocar pagos. | Medio | Media | Necesita decisión |
| CRM | 21 071 leads, 38 columnas; 8 leads ya son influencers y 1 es marca; 34 leads con baja registrada (`email_optouts`) conservan su estado de calificación. El bloqueo de envío ya vive en `getResend()`/opt-outs. | Marcar visualmente «ya es influencer/marca» y dejar el estado como está. | Bajo | Baja | Conservar como está |
| CRM | `industry` y `industry_filter`, `position` y `position_filter` coexisten (normalizadas para filtros). Columnas `email_*` de validación 87 % nulas. | Conservar: son derivadas para filtros. | Bajo | Baja | Conservar como está |
| Soporte | `tickets.priority` = P2 en 89 de 89; `ai_review` 100 % nula (5 archivos la mencionan). 1 ticket abierto hace más de 7 días sin respuesta. | Responder el ticket; decidir si `ai_review` sigue en el plan. | Bajo | Baja | Necesita decisión |
| Marcas | Notas internas visibles a influencers que registraron la marca; PayPal reactivaba suspendidas; aviso de suspendida incorrecto; dirección sin coordenadas. | — | — | — | Corregido (ver más abajo) |
| Marcas | 2 marcas con dos owners activos (backfill de `20261004184849` promueve a owner a todo usuario con `brand_id` en su metadata). | Revisar esas 2 marcas a mano; no cambiar permisos aún. | Medio | Media | Necesita decisión |

## Correcciones aplicadas hoy (todas locales, sin commit)

1. `brands.notes` solo Admin: rutas de influencer y de registro de marca ya no lo leen, escriben ni devuelven; la pantalla de influencer ya no lo muestra.
2. PayPal: el webhook ya no toca `brands`; `paypal/complete` solo aprueba marcas `pending_approval`.
3. Marca suspendida: aviso «Esta marca se encuentra suspendida. Contacta a soporte para solicitar una revisión.», sin redirección a Planes.
4. Direcciones de marca con el buscador de Google Maps existente; editar a mano invalida `place_id` y coordenadas.
5. Suspensión con motivo obligatorio e historial en `audit_logs`; ya no borra el plan manual.
6. `rejected_at` al rechazar una invitación.
7. Guardado parcial de `/api/brand/me` (ya no borra contacto ni coordenadas).

## Correcciones rápidas (listas, esperan visto bueno)

1. Filtrar entregables de participantes rechazadas en `GET /api/campaigns` (KPI).
2. Mostrar «Gastado» solo si hay dato (o calcularlo).
3. Actualizar CLAUDE.md §16.1 con `expired` y `withdrawn`.
4. Mostrar «sin redes» en vez de 0 seguidores.

## Decisiones que requieren tu aprobación

1. Recortar la vista de marca del detalle de campaña (notas internas, metadata, contactos de colaboradoras).
2. Retirar `campaign_influencers.status` (tras auditar consumidores).
3. Unificar `published_url`/`content_url` y retirar columnas muertas de entregables.
4. Ubicación única (`location_id`) y qué hacer con las 729 sin comuna.
5. Rellenar `accepted_at`/`rejected_at` históricos (cambio de datos).
6. Qué hacer con 102 perfiles sin vínculo y con las 2 marcas con doble owner.
7. Bookings: ¿existe el proceso de confirmación?
8. Aprobar la migración local de columnas de `influencers` (incluye `is_verified` y las fechas de invitación).

## Orden óptimo de implementación

1. KPI de entregables (impacto visible, bajo alcance).
2. Recorte de la vista de marca (privacidad).
3. Fechas de decisión (código ya hecho; luego histórico).
4. Retiro de columnas con 0 uso (una sola migración revisada, primero DEV).
5. Ubicación única (influencers → bookings → CRM).
6. Estado de participación (una columna) y entregables (`content_url`).
7. Consolidar titulares/miembros de marca.

## Pruebas necesarias antes de publicar

- `npm test` (919 pasan hoy), `tsc`, `next lint` y `next build` (pasan hoy).
- Con sesión en DEV: guardar dirección sin perder contacto; suspender con motivo y comprobar que el plan sigue; marca suspendida ve el aviso; pago PayPal sandbox no reactiva; logo subir/reemplazar; WhatsApp.
- Pruebas nuevas por hacer: KPI sin participantes rechazadas; vista de marca sin notas internas; migración de columnas en una base de prueba con datos reales copiados.
