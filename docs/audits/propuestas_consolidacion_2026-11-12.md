# Propuestas de consolidación — SCENCE (2026-11-12)

Solo propuestas: nada de esto está ejecutado. Datos de producción en solo lectura (2026-11-12). Cada propuesta es de un cambio pequeño, con orden, consumidores a tocar, pruebas y reversión. Si algo ya funciona, se conserva.

## 1. Ubicaciones: `location_id` como única fuente

**Hoy.** `influencers.location_id` existe en 2 884 de 3 170 filas (2 034 comuna, 729 solo país, 121 solo región, 286 sin ubicación). El texto `city`, `commune`, `country` y `address` queda como copia: 762 filas tienen `location_id` y ningún texto; ninguna tiene texto sin `location_id`. `bookings` guarda `location` como texto (8 de 12 sin `location_id`). `crm_leads` guarda `commune`, `region` y `country` como texto (en el CRM es intencional: no son usuarios).

**Propuesta (3 pasos, de menor a mayor riesgo).**
1. Bookings: al crear o editar una reserva, guardar `location_id` y dejar el texto solo como respaldo de lectura. Sin tocar las 12 filas existentes.
2. Influencers: ninguna pantalla debe leer `city/commune/country`; derivarlos con `location_breadcrumb()` / `withOfficialInfluencerLocation()` (ya existe). Después retirar las columnas de texto en una migración aparte.
3. Pedir comuna a las 850 con solo país o región (aviso en su perfil), sin forzar.

**No tocar:** `crm_leads` (texto), `locations` (fuente de verdad), `address_lat/lng` de influencers (hay formulario activo).
**Pruebas:** un listado de influencers por comuna antes/después; reserva con y sin `location_id`.
**Reversión:** pasos 1 y 3 no borran nada; el 2 exige respaldo previo de las columnas.

## 2. Estados de postulaciones: una columna

**Hoy.** `campaign_influencers.application_status` (pending, accepted, rejected, expired, withdrawn) es la fuente de verdad (§16.1). `campaign_influencers.status` (enum de campaña) sobrevive: 46 `draft/accepted`, 21 `canceled/rejected`, 1 `active/rejected`. Lecturas que quedan: `CampaignDetail.tsx` (filtro por estado, línea ~1796) y `api/brand/influencers/ranking/route.ts` (línea ~76).

**Propuesta.**
1. Cambiar esas 2 lecturas para usar `application_status` (el filtro de CampaignDetail pasa a los 3 estados reales).
2. Revisar los otros archivos que mencionan `.status` junto a la tabla (la búsqueda muestra solo estos 2 usos directos, pero hay que confirmar los `select('*')`).
3. Dejar de escribirla (ya no se escribe) y retirarla en una migración posterior.
4. Actualizar CLAUDE.md §16.1 con `expired` y `withdrawn`.

**Pruebas:** guardia estática (no hay lecturas de `ci.status`) y los tests de postulación existentes.
**Reversión:** la columna se conserva hasta el paso 3.

## 3. URLs de entregables: `content_url` como única

**Hoy.** `content_url` tiene valor en 232 entregables. `published_url` tiene 0, pero **tiene código activo**: `api/campaigns/[id]/deliverables/route.ts` (línea ~165) la escribe cuando Admin envía `submitted_url`, y `sync-metrics` la usa como clave de actualización. 32 archivos la mencionan.

**Propuesta.**
1. Decidir qué significa «publicada»: si es la misma URL que `content_url`, el endpoint de Admin debe escribir `content_url` y `sync-metrics` leer `published_url ?? content_url` (mientras exista).
2. Después de unos días sin escrituras, retirar `published_url`, `caption`, `hashtags` y `platform` (100 % nulas).

**Pruebas:** enviar un entregable como influencer y como Admin; sincronizar métricas.
**Reversión:** sin borrar columnas hasta confirmar que nadie escribe `published_url`.
**Decisión previa:** qué significa «publicada» frente a «enviada».

## 4. Titulares de marca: `organization_members` como fuente

**Hoy.** De 79 marcas, 49 tienen `brands.user_id`; las 49 coinciden con un owner activo en `organization_members`. 2 marcas tienen un segundo owner (promovido el 2026-10-04 por la migración `20261004184849`). `brand_members` (9 filas) solo aporta invitaciones pendientes (2); los 7 usuarios aceptados ya están en `organization_members`. 14 archivos leen `brands.user_id`; `resolveBrandAccess` no lo usa.

**Propuesta.**
1. Definir el titular como `organization_members.is_owner` (único activo). Resolver a mano las 2 marcas con doble owner.
2. Cambiar el trigger/backfill que asigna `is_owner = true` a cualquier usuario con `brand_id` en su metadata (causa probable de los dobles owners; confirmar al revisar las 2 marcas) para que solo lo haga con el titular.
3. Mantener `brands.user_id` como copia de lectura (la ficha Admin y los correos la usan) hasta migrar sus 14 lectores; mantener `brand_members` para invitaciones pendientes.
4. Más adelante, mover las invitaciones pendientes a `organization_members` (con `joined_at` nulo) y retirar `brand_members`.

**No tocar ahora:** permisos, agencias (`resolveAgencyBrandAccess`), `brand_collaborators`.
**Pruebas:** registro, invitación, aceptación, reasignación y revocación con base en memoria (hay `brand-membership-preserve-role.test.ts`) más un caso nuevo de «invitar no crea owner».
**Reversión:** el paso 2 es una función SQL; se puede restaurar la anterior.
