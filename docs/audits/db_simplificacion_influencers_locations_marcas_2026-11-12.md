# Simplificación de base de datos: Influencers, Locations y Marcas — 2026-11-12

Solo lectura. Producción `xzzbishzfyovrladcaeb` con conteos agregados (sin datos personales; no se muestran nombres, correos, teléfonos ni RUT). No se consultó DEV. Cruce con `src/`, `scripts/`, `tests/` y con el catálogo de Postgres (políticas, vistas, índices, funciones, triggers, FKs). No repite `estandarizacion_scence_2026-11-12.md` ni `propuestas_consolidacion_2026-11-12.md`; las profundiza en este alcance. Nada está ejecutado. Dos migraciones borrador al final.

## Resumen

- Las tablas del alcance son sanas en integridad: sin duplicados de `user_id`, correo, RUT, par `(influencer, plataforma)` ni `(campaña, marca)`; `organization_members.brand_id` coincide con la organización de la marca en 50/50; sin huérfanos en las FKs revisadas.
- El ruido real está en **organizaciones sin uso** (35 de 134 no tienen ninguna referencia en 26 tablas), **dos pares de columnas gemelas** (`synced_at`/`last_synced_at`, texto/`location_id`), **`is_primary` sin marcar en 690 influencers** y **columnas que parecen muertas pero tienen función** (se conservan).
- Hay una función que no existe aunque las columnas sí: **recordatorios de NDA** (7 de 8 NDA pendientes están vencidos y `reminder_sent_at`/`final_reminder_sent_at` están en 0/12; ningún código las escribe). No es una columna para borrar: es seguimiento manual que el producto debería hacer (CLAUDE.md §3).
- Historia protegida (no se propone perderla): 319 fechas de invitación, 95 aceptaciones de términos (16 influencers con más de una versión; FK `RESTRICT`), 12 documentos de marca (3 NDA y 1 contrato firmados), 2 contratos, 21 `subscription_plan_override`.

## 1. Influencers / Profiles

Tablas: `influencers` 3 170 · `influencer_social_profiles` 4 032 · `profiles` 3 031 · `influencer_private_data` 12 · `influencer_terms_acceptances` 95 · `influencer_documents` 13 · `influencer_rate_cards` 0 · `influencer_payment_methods` 0 (en producción se llaman así; no existen `rate_cards` ni `payment_methods`).

| # | Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|---|
| I1 | Migración sin aplicar `20261110230000` elimina `portal_invite_sent_at` (319 fechas) pasándolas a `metadata`. No verifica al final que se copiaron todas. | 319 con fecha; 306 tienen fecha de invitación, cuenta y **ningún** ingreso registrado (`metadata.portal_logged_in_at` ausente): es la lista natural de seguimiento. 0 usos en `src/` (solo texto en `email-catalog.ts`). 0 en políticas/vistas/funciones. | Antes de aplicarla, añadir una aserción final: `count(metadata ? 'portal_invite_sent_at')` ≥ 319 y abortar si no. Alternativa más segura: conservar la columna (es un `timestamptz` consultable; en `metadata` no tiene índice ni tipo). | Bajo con la aserción | Alta | Necesita decisión (columna vs metadata) |
| I2 | Ubicación: texto (`city`, `commune`, `country`) coexiste con `location_id`. | `location_id` en 2 884; texto: city 1 354, commune 1 686, country 1 696; 751 con `location_id` y sin texto. 286 sin ubicación (285 sin texto; **1 con `city` y sin `location_id`**: rescatar antes de retirar). Precisión: 2 034 comuna, 121 región, 729 solo país. | Ya propuesto (consolidación §1). Añade: revisar la fila con `city` sin `location_id`, y no retirar columnas hasta que `withOfficialInfluencerLocation()` sea el único lector (56 archivos mencionan `.city/.commune`). | Medio | Media | Necesita decisión |
| I3 | `influencer_social_profiles.synced_at` y `last_synced_at` son gemelas. | Iguales en las 2 638 filas con dato; 1 394 vacías en ambas. `synced_at`: 13 archivos + 2 índices (`idx_social_profiles_synced`, cola `ig_sync_queue_idx`); `last_synced_at`: 5 archivos (lo escribe `business-discovery.ts`, lo lee `campaign-audience.ts`). | Elegir `last_synced_at`, mover lecturas y los 2 índices, luego retirar `synced_at`. Antes, backfill `last_synced_at = synced_at` donde falte. | Medio (cola de sincronización IG) | Media | Necesita decisión |
| I4 | 690 influencers con redes y **ninguna `is_primary`** (689 tienen Instagram; 363 con una sola red, 319 con dos). | 2 212 `is_primary` (todas instagram). El código cae a `find(is_primary) ?? profiles[0]` (`brand/influencers`, `affiliate`): con dos redes el orden no está definido y puede mostrar TikTok. | Backfill: marcar Instagram como principal cuando no hay ninguna. **Toca lo que ve la marca (seguidores) → Regla Cero: auditar y aprobar antes.** No hay migración borrador por eso. | Medio | Media | Necesita decisión |
| I5 | `influencers.rating` vale 0,00 en 3 095 de 3 170 (valor por defecto, no «sin nota»). | Solo 75 tienen nota real. 27 archivos la leen. | Mostrar vacío cuando es 0 (cambio de presentación); no tocar datos. | Bajo | Baja | Listo para corregir |
| I6 | Columnas vacías con código activo: `gender` (0/3 170; `writable-fields.ts`, tipos), `address_lat`/`address_lng` (0/3 170; formulario de alta Admin y `POST /api/influencers`). | El formulario envía coordenadas pero ninguna llegó a guardarse; `address` libre sí (2 165). | Conservar. Si no se piensa usar mapa, retirar de formulario, ruta y tabla **juntas** (otro frente). | Bajo | Baja | Conservar |
| I7 | Metadatos duplicados de Instagram dentro de `influencers.metadata`. | `instagram_verified` 2 064, `instagram_bio` 2 008, `instagram_engagement` 1 964, `instagram_posts_count` 2 062, `last_ig_sync` 2 096; **0 referencias en `src/`**. 56 influencers tienen `last_ig_sync` pero su perfil social no tiene `last_synced_at`. | No tocar: es historial de importaciones, parte único. Documentarlo como legado. | Bajo | Baja | Conservar |
| I8 | Dos campos de nota interna: `notes` (143) y `metadata.note` (60). | — | Unificar en `notes` en una limpieza futura; sin urgencia. | Bajo | Baja | Necesita decisión |
| I9 | `profiles`: defaults de México y columnas vacías. | `timezone` = America/Mexico_City en 3 028 de 3 031 (default de la tabla; solo 3 en Santiago). `avatar_url` 0/3 031 pero `PATCH /api/settings/profile` la escribe → **no retirar sin tocar esa ruta**. `phone` 6/3 031. `signer_rut`/`signer_role` 8 (firma de NDA: activas). `onboarded_at` ya cubierta por `20261112120000`. | Cambiar el default a `America/Santiago` (solo filas nuevas) es seguro pero es decisión de negocio; igual para `organizations.country` (ver M3). Conservar `signer_*`. | Bajo | Baja | Necesita decisión |
| I10 | 102 `profiles` sin influencer ni membresía. | 2 960 influencer · 67 brand_manager · 4 member. | Ya en auditoría general. Diagnosticar origen antes de cualquier limpieza. | Medio | Media | Necesita decisión |
| I11 | Tablas privadas y legales con poco volumen. | `influencer_private_data` 12 (RUT, solo service role), `influencer_documents` 13 (11 influencers; `private` 9, `approved_brands` 4), `influencer_terms_acceptances` 95 (78 influencers; 16 con más de una versión). | **Conservar.** Son evidencia legal/privada; `terms` tiene FK `RESTRICT` a propósito. No fusionar con `influencers` (filtraría RUT a marcas, CLAUDE §16.16). | — | — | Conservar |
| I12 | `influencer_rate_cards` (0, 9 archivos la usan) e `influencer_payment_methods` (0, solo `hardDelete.ts` la menciona). | Vacías. | `rate_cards`: conservar (función activa). `payment_methods`: sin feature en código; toca **pagos** (Regla Cero): revisar `payroll`/`payments` antes de proponer retiro. | Medio | Baja | Necesita decisión |
| I13 | `influencer_social_profiles`: `sync_locked_until` 0/4 032, `raw_data` vacío en 4 032, `verified` true en 26. | `sync_locked_until` es el candado por fila de `followers-sync.ts` (valor transitorio). `raw_data` solo aparece en una lista de columnas de `social-profiles.ts`. | Conservar `sync_locked_until` y `verified`. `raw_data`: decidir si se usará; hoy sin escritores aparentes. | Bajo | Baja | Conservar / Necesita decisión (`raw_data`) |

## 2. Locations

Tablas: `locations` 1 107 (194 country, 88 region, 819 commune, 6 place, 0 city) · `campaign_locations` 1 · `campaign_audience_locations` 19 (una campaña, todas a nivel país).

| # | Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|---|
| L1 | El modelo ya es una sola tabla autorreferenciada y consistente. | 0 nombres duplicados por padre; `locations_place_fields_check` obliga a que geografía no tenga dueño ni dirección; 6 places con dueño. | Sin cambios. | — | — | Conservar |
| L2 | Columnas vacías con función: `lat`/`lng` (0/1 107; `POST /api/locations` y `PATCH` las aceptan, hay CHECK de rango), `notes` 8, `created_by` 3. | Los 6 lugares no tienen coordenadas. | Conservar; son del lugar físico (marca/influencer). | — | — | Conservar |
| L3 | Valores permitidos sin uso: `level='city'` (0 filas) y `type` `showroom`/`event` (0). | `type` usado: brand_venue 2, store 2, influencer_home 1, other 1. | Conservar: son diseño (ciudades opcionales, ver §16.11), cuestan nada. | — | — | Conservar |
| L4 | Dueño del lugar guardado en tres columnas. | Los 6 places tienen `organization_id` y (`brand_id` 5 o `owner_influencer_id` 1); `organization_id` de un lugar de marca = `brands.organization_id` (derivable). 15 políticas RLS usan `organization_id`. | No tocar: el CHECK y la RLS dependen de ello. | Alto si se toca | — | Conservar |
| L5 | `locations.region` (texto) en 2 places, redundante con el padre. | 2 de 1 107; `search_locations` y `location_search_path` la nombran. | Revisar si algún consumidor la lee antes de retirarla; ahorro mínimo. | Bajo | Baja | Necesita decisión |
| L6 | **Dos fuentes para el lugar de una campaña.** CLAUDE §16.6 dice «dirección en `metadata.address`», §16.11 dice «solo `location_id`». | 17 de 20 campañas con `metadata.address` (texto); `campaign_locations` solo 1 fila (con instrucciones, `is_primary`). `campaign_audience_locations`: 19 filas. | Decidir una regla: `campaign_locations` para sede con `location_id`, `metadata.address` solo para texto libre sin lugar registrado. Actualizar CLAUDE.md. **No** migrar 17 textos a places (no son lugares validados). | Medio (UI de campaña) | Media | Necesita decisión |
| L7 | `bookings.location` texto vs `location_id` (8 de 12 solo texto); `crm_leads` texto. | Ya en consolidación §1. CRM es intencional. | Sin novedades. | Bajo | Baja | Ya propuesto |
| L8 | Las tablas `campaign_locations`/`campaign_audience_locations` tienen poco dato pero están en código (8 y 3 archivos), triggers de validación y tests. | 1 y 19 filas. | **Conservar** (función activa aunque casi vacías). | — | — | Conservar |

## 3. Brands / Organizations

Tablas: `brands` 79 · `organizations` 134 · `organization_members` 75 · `brand_members` 9 · `brand_documents` 12 · `contracts` 2 · `brand_influencers` 2 · `brand_collaborators` 0 · `campaign_brands` 41 · `campaign_brand_collaborations` 12 · `campaign_brand_applications` 0.

| # | Problema | Evidencia | Solución mínima | Riesgo | Prioridad | Estado |
|---|---|---|---|---|---|---|
| M1 | **35 organizaciones sin ninguna referencia** (revisadas las 26 tablas que apuntan a `organizations`: 0 filas). | 26 de 28 `agency` (creadas el 2026-07-01 con el patrón «org de <persona>» del flujo antiguo de alta de influencers) y 9 de 106 `brand` (junio–septiembre, slug tomado del dominio del correo). 27 `brand` sin marca en total; 79 marcas ↔ 0 organizaciones con más de una marca (una marca = una org, §16.9). Las 134 están `is_active = true`. Es el pendiente 6 de §16.9. | Diagnóstico de solo lectura (abajo) y, con aprobación, **archivar** (`is_active=false`) en vez de borrar; verificar antes que ningún código filtre por `is_active` de forma que rompa registro. No hay migración borrador (no hay tabla de archivo ni decisión). | Medio | Media | Necesita decisión |
| M2 | `organizations.google_*` (3) y `subscription_period_end`: columnas vacías y sin uso. Las tres de Google son para tokens OAuth en texto plano. | 0/134 las tres y 0/134 la cuarta; 0 políticas/vistas/índices/funciones; 0 lecturas/escrituras en `src/` y `scripts/`. | **Migración borrador `20261112130000`** (con guarda que aborta si hay datos). Hace innecesaria la propuesta de privilegios por columna de 2026-10-22. | Bajo | Alta | Listo para corregir |
| M3 | `organizations.subscription_status` (134 = `free`) y `subscription_plan` (132 `free`, 2 `basic`) no se leen en código. La fuente real es `subscriptions` + `brands.subscription_plan_override`. | Las 2 organizaciones con `basic` no tienen suscripción activa (una `incomplete`, otra sin fila). Default de `country`: MX 116 / CL 18. | Copiar los 2 `basic` a donde corresponda (o confirmar que son basura) y retirar; no se incluyó en la migración por esos 2 datos. `country` default `CL` es decisión de negocio. | Bajo | Baja | Necesita decisión |
| M4 | Datos de marca duplicados en `organizations`: `logo_url` (4), `website` (1), `industry` (1), `tax_id` (1), `billing_email` (1). | La fuente de la marca es `brands` (`logo_url` 6, `rut`, etc.; §16.15 ya prohíbe `organizations.tax_id` como fuente). Los dos endpoints de logo escriben en **ambas** tablas; 2 marcas tienen logo solo en `brands`. `settings/organization` y `CampaignDetail` (billing_email) sí las usan → **no retirar sin tocar esas pantallas**. | Para organizaciones de marca, dejar de escribir `organizations.logo_url` cuando se toque el código (otro frente). | Bajo | Baja | Necesita decisión |
| M5 | Índice duplicado en `brands(user_id)`. | `brands_user_id_unique` (único parcial, 3 128 usos) y `idx_brands_user_id` (igual, plano, 5 usos). | **Migración borrador `20261112130100`** (guarda: existe el único equivalente y el plano no respalda restricción). | Bajo | Media | Listo para corregir |
| M6 | Quién refirió a la marca: tres formas. | `referred_by_influencer_id` 3; `metadata.referred_by_instagram` 14 (solo texto); `metadata.referrer_user_id` 2. | Sin cambio ahora; definir una sola cuando se retome el linaje de marcas (§16.9, pendiente 2). | Bajo | Baja | Necesita decisión |
| M7 | `brands.address2_*` (5 columnas) 0/79, con formulario y ruta activos. `address_place_id`/`lat`/`lng` 0/79, con código nuevo de Google Maps. | 6 marcas con dirección principal estructurada. | `address_*` nuevas: conservar. `address2_*`: decidir si existe «segunda dirección»; si no, quitar formulario y columnas juntos. | Bajo | Baja | Necesita decisión |
| M8 | Notas: `brands.notes` (solo Admin) y `metadata.notes` (1). Un par de marcas con el mismo nombre. | 1 nombre repetido (0 repetidos en RUT e Instagram normalizado). | Revisar a mano el par (posible marca duplicada; no fusionar automáticamente). | Bajo | Baja | Necesita decisión |
| M9 | Titulares: `brands.user_id` (49) vs `organization_members.is_owner`. | 69 filas con `is_owner` (5 inactivas); `role` guarda `brand_manager` aun para owners (§16.13: manda `is_owner`); 6 usuarios en más de una organización; `invited_by` 0/75 (activa en rutas de equipo). 47 políticas y 5 funciones usan `brands.user_id`. | Ya propuesto en consolidación §4. No retirar `user_id` (47 políticas). | Alto | Media | Ya propuesto |
| M10 | `brand_members` (9): 7 aceptados ya están en `organization_members`; **2 invitaciones pendientes solo existen aquí**. 17 archivos la usan; trigger `trg_ensure_brand_member_org_membership`. | `joined_at` nulo en 2. | Conservar hasta mover las 2 invitaciones; no perderlas. | Medio | Baja | Ya propuesto |
| M11 | Cuatro tablas «marca ↔ campaña/marca»: `campaign_brands` (41), `campaign_brand_collaborations` (12, seguimiento comercial con lead), `campaign_brand_applications` (0), `brand_collaborators` (0). | No hay datos duplicados entre ellas. `campaign_brands`: 36 collaborator, 4 co_sponsor, 1 partner; 40 de 41 son marcas distintas de `campaigns.brand_id` (dueña) y 1 repite a la dueña como «collaborator» (anomalía). 18 de 20 campañas con dueña no tienen fila en `campaign_brands` (esperado). `cbc.plan_id/contribution_detail/quantity` 0/12 con UI activa. | **No consolidar**: propósito distinto, poco volumen, mucho código (25, 3 y 2 archivos). Corregir a mano la fila que repite a la dueña. Conservar las dos vacías (función activa). | — | Baja | Conservar |
| M12 | **Recordatorios de NDA inexistentes.** | `brand_documents`: NDA 11 (3 firmados, 8 pendientes), contrato 1 firmado; los 12 con correo inicial y `due_at`; **7 de 8 pendientes vencidos**; `reminder_sent_at`/`final_reminder_sent_at` 0/12 y sin escritores en código. 1 de los 12 documentos pertenece a una marca aún `pending_approval`. | No borrar columnas: son la función faltante. Decidir si se envía recordatorio automático (menos seguimiento manual, §3) usando `getResend()` y esas dos columnas. | Bajo | Alta (comercial) | Necesita decisión |
| M13 | Contratos y documentos legales: `contracts` (2: draft y generated, de campaña, con `docusign_envelope_id`) vs `brand_documents` (NDA/legal de marca, aceptación en la app). | Procesos distintos, 2 y 12 filas. | **No unificar.** Conservar los 12+2 con `content_snapshot`, `signer_*`, `acceptance_ip` y `signed_legal_data`. | — | — | Conservar |
| M14 | `brand_influencers` (2): roster; `organization_id` derivable de la marca. | 2/2 coinciden. | Conservar (9 archivos, alcance de privacidad §16.17). | — | — | Conservar |

### Diagnóstico de solo lectura para M1 (no ejecutado en esta auditoría más allá de conteos)

```sql
-- Organizaciones sin ninguna referencia en las tablas que apuntan a organizations.
-- Devuelve solo tipo, mes y conteo; no seleccionar name/slug (pueden contener nombres de personas).
with fks as (
  select conrelid::regclass::text tbl, a.attname col
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'public.organizations'::regclass and array_length(c.conkey, 1) = 1
), refs as (
  select o.id, o.type::text ty, date_trunc('month', o.created_at)::date mes,
    (select coalesce(sum((xpath('/row/n/text()', query_to_xml(
       format('select count(*) n from %s where %I = %L', tbl, col, o.id), false, true, '')))[1]::text::bigint), 0) from fks) n
  from public.organizations o)
select ty, mes, count(*) from refs where n = 0 group by 1, 2 order by 1, 2;
```

## Qué se conserva aunque esté vacío o casi vacío

`brand_collaborators` (0, M5 de §16.9), `campaign_brand_applications` (0, facturas y oportunidades), `influencer_rate_cards` (0, 9 archivos), `campaign_locations` (1) y `campaign_audience_locations` (19), `influencer_social_profiles.sync_locked_until`, `locations.lat/lng/type/level='city'`, `brands.address_*` de Google Maps, `campaign_brand_collaborations.plan_id/contribution_detail/quantity`, `brand_documents.reminder_*`, `organization_members.invited_by`, `profiles.avatar_url` y `signer_*`, `influencers.gender/address_lat/address_lng`.

## Orden de implementación

1. (Hoy, sin impacto) Migración `20261112130000` y `20261112130100` en DEV; después de `npm test` y abrir Ajustes > Organización, a producción con autorización.
2. Antes de aplicar `20261110230000`: decidir columna vs `metadata` para `portal_invite_sent_at` y añadir la aserción de 319 filas (I1).
3. M12: decidir recordatorios de NDA (valor comercial inmediato, sin cambio de esquema).
4. I4 (`is_primary`) con auditoría de visibilidad a marcas (Regla Cero) y L6 (regla única de lugar de campaña).
5. I3 (`synced_at` → `last_synced_at`): backfill, cambio de lecturas e índices, retiro al final.
6. M1: diagnóstico y archivo de las 35 organizaciones sin uso.
7. Consolidación ya propuesta (texto → `location_id`, titulares de marca, `brand_members`).
8. Decisiones de baja prioridad: M3, M4, M6, M7, I5, I8, I9.

## Pruebas necesarias

- Migraciones: aplicar en DEV con datos copiados; confirmar que las guardas abortan si se insertan datos en las columnas (probar insertando un valor temporal en DEV); `npm test`, `tsc`, `next lint`, `next build`.
- M2/M5: Ajustes > Organización (guardar nombre, sitio, correo de facturación), registro de marca (`register_brand`), búsqueda por `user_id` en rutas de marca.
- I1: contar filas con `metadata ? 'portal_invite_sent_at'` = 319 y comparar 3 fechas al azar con respaldo (sin exponerlas).
- I3: sincronización de Instagram (cola, candado por fila) y `campaign-audience`.
- I4: listado de marcas (`/api/brand/influencers`, ranking) antes/después con una influencer de dos redes.
- L6/M1: crear campaña con y sin lugar; registro de influencer y de marca sin crear organizaciones nuevas vacías.
- M12: envío de recordatorio solo mediante `getResend()`, con la barrera de influencer inactiva intacta (no aplica a marcas: declarar `emailAudience('brand')`).

## Migraciones borrador (no ejecutadas)

- `supabase/migrations/20261112130000_drop_empty_organization_google_and_period_columns.sql`
- `supabase/migrations/20261112130100_drop_duplicate_brands_user_id_index.sql`

No se creó ninguna otra: el resto exige decisión de negocio, cambio de código previo o toca visibilidad/pagos.
