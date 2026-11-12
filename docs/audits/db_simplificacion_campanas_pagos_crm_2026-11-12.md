# Simplificación de base de datos: campañas, asistencia, entregables, reservas, pagos, CRM y soporte — 2026-11-12

Solo lectura: producción (`xzzbishzfyovrladcaeb`) con conteos agregados (sin datos personales) y DEV (`dexpvoubiklgotuukrml`) para EXPLAIN. Código local leído con grep en `src/`, `scripts/`, `tests/`. No se aplicó nada. Complementa (no repite) `estandarizacion_scence_2026-11-12.md` y `propuestas_consolidacion_2026-11-12.md`; no repite lo cubierto por `20260906180000_drop_legacy_campaign_columns.sql`, `20261110230000_drop_unused_influencer_columns.sql` ni `20261112120000_drop_unused_empty_columns.sql`.

Leyenda de Estado: **LC** = Listo para corregir · **ND** = Necesita decisión · **C** = Conservar.
Pagos, suscripciones, contratos y NDA: solo documentados; ninguna propuesta cambia su funcionamiento.

## Hallazgos transversales

1. Las migraciones borrador de esta auditoría son solo **índices (derivados)** y **6 columnas 100 % vacías sin uso** (guardas que abortan si hay datos).
2. `crm_email_events` tiene 103 784 filas y **81 669 (79 %) sin `lead_id`**: el webhook de Resend guarda también correos que no son del CRM. Solo 3 451 de ellas coinciden por email con un lead. Los KPI ya las ignoran (`crm_email_kpis` hace join con leads).
3. Dos tablas existen sin lector o sin escritor en el código: `notifications` (0 filas, solo inserts, sin pantalla que la lea) y `user_todos` (8 filas, 0 referencias en el repo).
4. `campaign_assets` (1 fila) quedó reemplazada por `media_files` (el módulo de archivos de campaña escribe en `media_files`, 20 filas con campaña).

## 4. Campañas (`campaigns`, `campaign_assets`, `campaign_locations`, `campaign_collaboration_plans`, `campaign_brand_applications`)

| Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|
| Legacy de `campaigns` aún en producción (43 columnas): `address`, `do_follow_links`, `internal_notes`, `sorteo_winner` 0/20; `content_guidelines` 10/20 (ya fusionada en `description`) | La migración `20260906180000` sigue sin aplicar | Aplicarla (ya revisada) primero en DEV | Bajo | Media | LC (ya existe migración) |
| `mention_handles` (10 campañas con datos) vs `social_tags` (15) conviven; `raffle_*`/`prize` 1-2 filas | Documentado en `20260906180000`; sin cambios | Backfill `mention_handles → social_tags` antes de retirar; decidir sorteo | Medio | Baja | ND |
| `budget_spent` = 0 en 20/20 y `budget_total > 0` solo en 1/20; `commission_rate` 1/20 | Columnas con UI («Gastado») sin dato | Mostrar solo si hay dato (ya propuesto) o calcular desde pagos; no retirar | Bajo | Baja | ND |
| `max_influencers` 0/20 pero **con función activa** (`enforce_campaign_influencer_capacity`, 15 archivos) | Tope opcional | — | — | — | C |
| Campañas abiertas con fecha de fin vencida: 4 (1 `active`) | `status in (draft,active,paused) and end_date < hoy` | Revisar a mano; si se quiere, cron de cierre (cambio de negocio) | Bajo | Baja | ND |
| Marca de campaña triple: `campaigns.brand_id` (19/20), `campaign_brands` (41) y `campaign_brand_collaborations` (12). 18 campañas tienen `brand_id` que no está en `campaign_brands`; 4 colaboraciones con marca fuera de `campaign_brands` | Son relaciones distintas (titular, marcas asignadas, colaboradoras comerciales) | No unificar; documentar el significado en CLAUDE.md. `campaign_brands` ya no incluye siempre al titular: los consumidores no deben asumirlo | Alto si se toca (permisos, regla cero) | — | C |
| `campaign_brand_applications` 0 filas, `campaign_collaboration_plans` 3, `campaign_brand_collaborations` 12 con `plan_id/quantity/contribution_detail` 0/12 | Función activa (colaboraciones, oportunidades, admin) | Conservar; las 3 columnas vacías son opcionales del formulario | — | — | C |
| `campaign_assets` (1 fila, tipo `photo`): 0 referencias en `src/` (solo mocks de tests/RLS); sustituida por `media_files`. Tiene política y trigger | `media_files` 26 filas (20 con campaña) y sin cruce por `storage_path` | Decidir si esa 1 fila se migra a `media_files`; luego retirar la tabla con copia previa | Bajo | Baja | ND |
| `media_files.width/height/duration_seconds/thumbnail_url` 0/26 y 0 usos; `deliverable_id` 0/26 pero el insert lo escribe en `null` | Sin dependencias en Postgres | Retirar las 4 (migración `20261112140300`); `deliverable_id` solo tras cambiar el insert | Bajo | Baja | LC |
| `campaign_locations` 1 fila, `campaign_audience_locations` 19 | Función activa, UI nueva (§16.11) | — | — | — | C |
| Índices: `campaigns` 20 filas, 167 901 lecturas secuenciales; los índices parciales `idx_campaigns_open_deadline` (0 usos) están sin uso pero cuestan nada | Tabla diminuta | Ninguna acción | — | — | C |

## 5. Postulaciones y asistencia (`campaign_influencers`, `campaign_influencer_notifications`)

| Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|
| `status` vs `application_status`: `status=draft` en **2 680 de 2 951** (91 %), incluidas 1 306 pendientes, 1 328 rechazadas y 46 aceptadas; `active` solo 250 (249 aceptadas, 1 rechazada); `canceled` 21 (todas rechazadas) | CLAUDE.md §16.1 prohíbe escribirla; 2 lecturas vivas (`CampaignDetail.tsx` ~1796, `brand/influencers/ranking` ~76) | Ya propuesto en `propuestas_consolidacion` §2: pasar esas 2 lecturas a `application_status`, luego retirar. Confirmar los `select('*')` antes | Alto si se retira sin auditar | Media | ND |
| Fechas de decisión: `accepted_at` nulo en 226 aceptadas (de 295), `rejected_at` nulo en 557 rechazadas (de 1 350); 1 rechazada con `accepted_at` | Ya reportado; ruta de rechazo de invitación corregida | Rellenar histórico = cambio de datos | Bajo | Media | ND |
| `invited_at` 0/2 951 y **0 usos** (las 36 invitaciones usan `origin='invitation'` + `created_at`) | Sin dependencias | Retirar (migración `20261112140300`) | Bajo | Baja | LC |
| `usage_rights` 0/2 951 | Ya en `20261112120000` | — | — | — | LC (ya existe) |
| `fee`, `message`, `payment_terms`, `rejection_reason` 0/2 951 **con código activo** (campañas personales de influencer, re-postulación) | `my-campaigns`, `apply`, `campaign-applications.ts` | Conservar | — | — | C |
| `campaign_influencer_notifications`: 23 427 filas, el índice `(campaign_id)` (296 kB) es redundante con el único `(campaign_id, influencer_id)`; falta índice por `influencer_id` (FK en cascada; `hardDelete` recorre 23 mil filas) | Todo el código filtra por `campaign_id` | Agregar `(influencer_id)` y retirar el redundante (`20261112140000`, `20261112140100`) | Bajo | Media | LC |
| Tabla de idempotencia de avisos, con función activa | CLAUDE.md §16.8 | — | — | — | C |

## 6. Entregables (`campaign_deliverables`, `media_files`, `barters`, `barter_*`)

| Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|
| `published_url`, `caption`, `hashtags`, `platform` 0/1 262; `published_at` 1/1 262. `published_url` tiene escrituras en la ruta Admin y `sync-metrics` | Ya en `propuestas_consolidacion` §3 | Decisión «publicada vs enviada»; luego una sola URL (`content_url`, 232 filas) | Medio | Media | ND |
| Sin índice en FK `campaign_influencer_id` (1 262 filas; FK en cascada y base de los KPI por participante) | `pg_constraint` sin índice con esa columna inicial | Crear `idx_campaign_deliverables_campaign_influencer` (`20261112140000`) | Bajo | Media | LC |
| Índice duplicado: `idx_deliverables_status` ≡ `idx_campaign_deliverables_status` (0 vs 1 194 usos) | Mismo `btree(status)` | Retirar el duplicado (`20261112140100`) | Bajo | Baja | LC |
| 123 entregables de participantes rechazadas (4 `approved`); 133 `approved` sin `reviewed_at` y 54 `rejected` sin `reviewed_at` (legado y vencidos por cron) | Estados válidos según §16.14; progreso consistente (0 `approved` con progreso distinto de 100) | No tocar el legado; revisar los 4 | Bajo | Baja | C |
| Asistencia vs estado: 157 con `attendance_response`, 45 con resultado; 63 entregables de evento sin respuesta (vencidos por cron) y 3 aprobados sin respuesta | Trigger `trg_campaign_deliverables_attendance_status` | Sin cambios (invariante §16.14) | — | — | C |
| `barters`: `status` (enum antiguo; solo valor `pactado` en 280/280) y `simple_status` (279 `pending`, 1 `completed`) conviven; la API usa `simple_status` y el estado detallado vive en `benefit_tracking` (40 con datos) | `advance_barter_status` aún menciona `evidence_url` | Dejar `status` como histórico; no escribir. Retirarlo requiere revisar esa función y `barter_status_history` | Medio | Baja | ND |
| `barters`: 280 filas con `description`, `estimated_value`, `agreed_date`, `responsible_id`, `evidence_url`, `notes`, `completed_at`… vacías (0/280) pero **con código activo**; `cancelled_by` 0/280 y **sin uso** | Ver código en `campaigns/[id]/barters` | Retirar solo `cancelled_by` (`20261112140300`) | Bajo | Baja | LC |
| Canjes ligados a participantes no aceptadas: 18 (CI rechazada/pendiente); 8 sin `campaign_influencer_id`; 1 CI con 2 canjes | Datos históricos | Revisar a mano | Bajo | Baja | ND |
| `barter_benefits` 0 filas con función activa (alta de beneficios estructurados); coexiste con `campaigns.campaign_benefits` (9 campañas) y `barters.benefit_tracking` | Tres representaciones del beneficio | Elegir una al consolidar canjes; no retirar nada hoy | Medio | Baja | C |
| `barter_status_history`: 280 filas (1 por canje), `from_status` y `note` 100 % nulos | Se escribe al crear | Conservar (auditoría) | — | — | C |
| `media_files`: ver Campañas | — | — | — | — | LC |

## 7. Reservas (`bookings`, `booking_influencers`, `events`, `event_ticket_types`, `ticket_sales`)

| Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|
| Flujo de confirmación por correo **no puede iniciarse**: `GET /api/bookings/confirm` exige `confirmation_token`, pero **nada genera el token** (0/12; solo la ruta lo lee) ni envía el correo (`email_sent_at` 0 usos) | `confirmation_status = pending` en 12/12, incluidas 4 con `status=confirmed` y `confirmed_at` nulo | Decidir: (a) construir el envío con token o (b) retirar `confirmation_status`, `confirmation_token`, `email_sent_at`, la ruta y la tabla `booking_influencers`. No retirar nada sin decisión | Bajo (12 filas) | Baja | ND |
| `bookings.influencer_id` 0/12 y `booking_influencers` 0 filas: **ninguna reserva tiene participantes**, aunque 4 rutas y la vista de influencer las consultan | Función activa (reserva de participantes desde Admin) | Conservar | — | — | C |
| Ubicación: 8 con texto sin `location_id`, 3 sin lugar, 1 con ambos | §16.11 | Ya propuesto: guardar `location_id` al crear | Bajo | Baja | ND |
| Columnas vacías 0/12: `fee`, `travel_budget`, `notes`, `internal_notes`, `virtual_link`, `calendar_event_id`, `canceled_at`, `cancellation_reason`, `confirmed_at` | `virtual_link`, `calendar_event_id`, `canceled_at`, `travel_budget`, `fee` tienen código activo; `email_sent_at` 0 usos | Esperar la decisión anterior; son 12 filas | Bajo | Baja | ND |
| `events` 1 fila (borrador), `event_ticket_types` 0, `ticket_sales` 0 | 6 y 3 archivos activos | Conservar (módulo de eventos sin lanzar) | — | — | C |
| Índices: 12 filas, `idx_bookings_*` casi sin uso | Tabla diminuta | Ninguna | — | — | C |

## 8. Suscripciones y pagos (SOLO análisis; nada cambia cobros)

| Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|
| Estados de `subscriptions` (170): `incomplete` 143 (todas con período vencido), `active` 19 (1 con período vencido), `past_due` 4, `canceled` 4 | Ya documentado: 143 son checkouts sin pago | Excluir `incomplete` en métricas; verificar la `active` vencida contra PayPal (solo lectura) | Medio | Media | ND |
| `trial_ends_at` 0/170 | Ya en `20261112120000` | — | — | — | LC (ya existe) |
| `subscription_payments` (44, todas PayPal `completed`): `receipt_storage_path`, `receipt_filename`, `receipt_mime_type`, `receipt_file_size`, `recorded_by` 0/44 y **0 usos** en `src/`; el único `receipt_storage_path` ocupa un índice | Resto del ledger con función activa | No tocar; registrar para decisión futura | — | Baja | ND (solo registro) |
| `subscription_plans.price_yearly` 0/5, 1 uso en `src/lib/subscription-plans.ts` | — | Conservar | — | — | C |
| `payments` 0 filas, 0 referencias en `src/` (no hay flujo que la escriba; FK a `invoices`) | Los cobros reales viven en `subscription_payments` | Candidata a retiro **solo con decisión de pagos** | Medio | Baja | ND |
| `payroll_runs/items`, `commission_settlements/_conversions`, `affiliate_conversions`: 0 filas con código activo (6-7 archivos); `affiliate_links` 80 | Función de nómina/comisiones | Conservar | — | — | C |
| `affiliate_links`: `idx_affiliate_code` duplica el único `affiliate_links_code_key` | Mismo `btree(code)` | Retirar el no-único en una migración de afiliados aparte (no se incluye: pagos) | Bajo | Baja | ND |
| `invoices` 10 / `invoice_line_items` 6 / `invoice_shares` 0: `owner_brand_id` nulo en 10/10 (por diseño §16.12); `payment_reference`, `pdf_url`, `terms` 0/10 | `pdf_url` solo en tipos; las otras con código | Conservar | — | — | C |
| Índice faltante en `subscriptions(organization_id)` (170 filas, 45 526 lecturas secuenciales) | Con 170 filas el recorrido es más barato que el índice | No crear | — | — | C |

## 9. CRM y soporte (`crm_*`, `email_optouts`, `tickets`, `ticket_replies`, `support_reply_templates`, `notifications`, `user_todos`)

| Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|
| `crm_email_events`: 81 669 de 103 784 sin `lead_id` (35 844 `email.sent` con 25 220 sin lead); solo 3 451 casan por email con un lead; 6 041 `recipient_email` con mayúsculas | El webhook guarda todo evento de Resend, incluido correo de la plataforma | Filtrar el webhook por etiqueta `crm` o archivar; opcional backfill por email (cambio de datos) | Medio | Media | ND |
| Sin índice por `job_id` (consultas de progreso del envío masivo: `event_type + raw_payload->>'job_id'`) y sin índice por `occurred_at` (KPI «actividad reciente») | 6 942 lecturas secuenciales; solo 2 602 eventos con `job_id` | Crear los dos índices (`20261112140200`); luego evaluar retirar `crm_email_events_event_type_idx` (1,1 MB) con EXPLAIN en copia con datos (DEV tiene 0 eventos) | Bajo | Media | LC |
| `crm_leads` (20 945): `ilike('email', …)` del webhook y de varias rutas hace Seq Scan (confirmado con EXPLAIN en DEV: `Filter: email ~~* …`); 116 290 lecturas secuenciales acumuladas. Los emails ya están en minúsculas y sin espacios (0 excepciones) | El índice `crm_leads_email_idx` no sirve para `ilike` | Cambiar esas búsquedas a `eq` con el email normalizado (código) y, si hace falta, un índice `lower(email)`. No incluido: depende de código | Bajo | Media | ND |
| `crm_leads` sin único por email: 20 755 emails distintos entre 20 755 con email (**0 duplicados**), 190 sin email | Importador deduplica en código | Evaluar único parcial `lower(email)` cuando se cambie la búsqueda (puede rechazar imports que hoy pasan) | Medio | Baja | ND |
| `crm_leads` 38 columnas: `position_filter` (3 046 con dato) **0 referencias** (solo `industry_filter` se usa); bloque `email_*` (2 784, solo lectura en detalle) | Derivadas de importación | Conservar (decisión previa); `position_filter` retirable más adelante con copia | Bajo | Baja | C |
| `crm_leads.converted_brand_id` 1 de 8 `converted`; 25 leads con baja registrada y `marketing_consent = true`; estados `attempted` 1 / `interested` 4 | El bloqueo de envío ya usa `email_optouts` | No cambiar; el consentimiento ya queda subordinado a la baja | Bajo | Baja | C |
| `crm_bulk_send_jobs` (51): `campaign_id`, `campaign_snapshot`, `attachment_*` 0/51; `campaign_snapshot` 0 usos, `campaign_id` sin uso en las rutas de envío; adjuntos con código activo. 9 jobs `processing` (desde 2026-10-09) y 20 `failed` | Atribución de campaña prevista y nunca conectada | Decidir si se conecta o se retira; revisar los 9 jobs `processing` (posibles colgados) | Bajo | Media | ND |
| `crm_lead_activities` (22 541): `campaign_id` 0/22 541 (con FK e índice parcial); falta índice en `created_by` (FK a profiles, solo al borrar usuarios) | Atribución no conectada | Igual que arriba; no crear índice en `created_by` | Bajo | Baja | ND |
| `email_optouts` 217 (200 rebotes, 16 bajas, 1 queja): 183 sin lead correspondiente | Fuente única de bajas | Conservar | — | — | C |
| `tickets` 89: prioridad `P2` en 89/89; `in_progress` 57; 1 `open` con más de 7 días sin respuesta; `ai_review` 0/89 con 5 archivos que la mencionan | Prioridad editable desde Admin | Responder el abierto; decidir si `ai_review` sigue | Bajo | Baja | ND |
| `ticket_replies`: `email_error` 0/139 (con código activo), 38 sin `email_status` (respuestas de usuarias) | — | Conservar | — | — | C |
| `support_reply_templates` 3 filas | Función activa | — | — | — | C |
| `notifications` 0 filas: solo 2 rutas **insertan** (NDA firmado, canjes) sin revisar el error; **4 documentos firmados** y 0 notificaciones; ningún lector en la app | Los avisos reales salen por correo | Decidir: construir la campana o retirar la tabla; revisar el error del insert | Bajo | Baja | ND |
| `user_todos` 8 filas, **0 referencias en el repo** | Tabla con RLS | Confirmar si la usa un cliente externo (MCP) antes de decidir | Bajo | Baja | ND |

## Migraciones borrador (no ejecutadas, solo DEV primero)

| Archivo | Qué hace | Riesgo |
|---|---|---|
| `20261112140000_add_missing_fk_indexes_deliverables_notifications.sql` | 2 índices en FKs (`campaign_deliverables.campaign_influencer_id`, `campaign_influencer_notifications.influencer_id`) | Muy bajo (bloqueo de escritura de milisegundos) |
| `20261112140100_drop_duplicate_indexes_deliverables_notifications.sql` | Retira 2 índices redundantes tras comprobar que existe el que los sustituye | Muy bajo; ir después de la anterior |
| `20261112140200_crm_email_events_lookup_indexes.sql` | 2 índices en `crm_email_events` (`job_id` parcial y `event_type, occurred_at`) | Bajo; medir antes/después |
| `20261112140300_drop_dead_columns_media_barters_ci.sql` | Retira `media_files.width/height/duration_seconds/thumbnail_url`, `barters.cancelled_by`, `campaign_influencers.invited_at` (0 datos, 0 usos). Aborta si hay datos o funciones que las mencionen | Bajo |

Cada archivo trae evidencia y reversión. Comprobado que los objetos existen igual en DEV (índices y columnas, 0 datos).

## Orden de implementación

1. Aplicar en DEV `140000` → `140100` → `140200` → `140300`; EXPLAIN de las consultas de envío masivo y de actividad reciente con una copia de eventos.
2. Aplicar `20260906180000` y `20261112120000` (ya existentes) en el mismo ciclo.
3. Código sin tocar datos: búsquedas de `crm_leads` por email con `eq` normalizado; filtro del webhook de Resend para eventos no CRM.
4. Decisiones de negocio (en este orden): estado de postulación (`status`), `published_url`, confirmación de reservas, atribución de campaña en envíos CRM, `notifications`/`user_todos`/`campaign_assets`.
5. Pagos y suscripciones: solo limpieza de métricas (`incomplete`) y revisión de la `active` vencida; sin cambios de esquema.
6. Producción solo tras validar en DEV y con autorización propia.

## Pruebas necesarias

- `npm test`, `tsc --noEmit`, `next lint`, `next build` tras cualquier cambio de código asociado.
- En DEV, antes y después de `140000`-`140300`: `EXPLAIN` de listado de entregables por participante, borrado de una influencer de prueba (cascada), `GET /api/campaigns` y carga de archivos de campaña (`media_files`), alta de canje y de postulación.
- Pruebas de `crm_email_events` con datos copiados: progreso de un envío masivo y KPI de actividad reciente (resultados idénticos, plan con índice).
- Pruebas nuevas: guardia estática de que no se lee `campaign_influencers.status`; envío masivo no cuenta eventos ajenos al CRM.
- Fuera de alcance de pruebas (no se tocan): contratos y firma de NDA, suscripciones, PayPal, nómina, comisiones.
