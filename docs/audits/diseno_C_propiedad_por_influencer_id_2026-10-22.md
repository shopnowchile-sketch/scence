# Diseño C — propiedad de los registros comerciales por `influencer_id` (evolución futura, NO implementada)

Decisión 2026-10-22: se mantiene la opción A (estructura actual). No se designa contenedor, no se elige organización, no se reasigna nada, no se cambia `organization_id`. Este documento solo describe C para evaluarla más adelante.

## Hechos de partida (producción, solo lectura)
- 0 fichas sin organización; 2875 de 2876 en `d23d88ee…` (0 marcas, 1 membresía super_admin, tipo agency); 1 ficha en `0be5025a…` (1 marca aprobada, 2 `brand_influencers`) — debe permanecer intacta.
- `d23d88ee…` tiene 15 campañas ligadas a marcas que viven en OTRAS organizaciones: la organización no es una marca.

## Idea
Los registros comerciales del influencer (suscripciones, pagos Pro, affiliate links/conversions, liquidaciones, tickets, contratos, barters, documentos, bookings propios) se identifican por `influencer_id`. `organization_id` deja de ser el dueño y queda como contexto opcional (la marca involucrada, p. ej. en campañas y contratos).

## Impacto por área
| Área | Cambio requerido | Riesgo principal |
|---|---|---|
| Pro / suscripciones | Checkout y activación autorizan por `influencer_id` (`influencers.user_id = auth.uid()`); `subscriptions.organization_id` pasa a nullable | Pro dejaría de depender de NULL/org; migrar 100 suscripciones sin perder historial |
| PayPal | `complete` y webhook resuelven por `influencer_id` (ya viaja en `custom_id`/metadata a verificar); sin org no hay 409 | Eventos en vuelo durante la migración; reconciliación de 28 pagos Pro |
| Afiliados | Links y conversions por `influencer_id`; liquidaciones por influencer; listados admin dejan de filtrar por org del admin | 61 links; reportes por marca deben derivarse vía campaña |
| Campañas | Marca dueña = `brand_id`/`created_by_brand_id` (ya existe); el influencer participa por `campaign_influencers`. Sin cambio de dueño | Las campañas "propias" del influencer (hoy 400 sin org) necesitan modelo explícito |
| Contratos | Parte influencer por `influencer_id`; parte marca por `brand_id` | 2 contratos; PDFs y plantillas leen org |
| Tickets (/api/support) | Dueño = influencer; la plataforma los atiende | 32 tickets; hoy `organization_id` NOT NULL |
| Permisos / RLS | Políticas "propias" por `user_id = auth.uid()`; plataforma por `isPlatformAdmin`; marcas ven solo lo que su campaña/contrato comparte | Es el mayor trabajo: reescribir `getOrgId`-dependientes y las 10 políticas dependientes de `influencers` |
| Aislamiento entre marcas | Una marca solo accede a un registro si existe vínculo explícito (campaña, contrato, brand_influencers) con su marca; nunca por pertenecer a la misma organización | Cualquier consulta sin ese vínculo es fuga: exige pruebas por tabla |

## Pasos si se aprueba (cada uno con su propia aprobación)
1. Inventario de cada consulta/escritura que usa `influencers.organization_id` (código, edge functions, scripts, RLS).
2. Columna `owner_influencer_id`/uso de `influencer_id` ya existente + índices; backfill idempotente en tablas piloto.
3. Doble escritura y lectura por `influencer_id` con la organización como respaldo.
4. Cambiar RLS y rutas; retirar NOT NULL de `organization_id` solo al final.
5. Pruebas de aislamiento entre marcas por cada tabla, en rama de pruebas (no producción).

## Qué NO hace este documento
No modifica datos ni esquema; no aplica migraciones; no cambia código.
