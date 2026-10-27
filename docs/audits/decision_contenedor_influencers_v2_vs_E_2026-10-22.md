# Contenedor comercial de influencers: v2 (organización designada) vs E (propiedad por `influencer_id`) — 2026-10-22

Estado: DIAGNÓSTICO. No se seleccionó, designó ni modificó ninguna organización. Mediciones: solo lectura en producción (proyecto `xzzbishzfyovrladcaeb`).

## 1. Resultados de solo lectura (producción)
- Fichas con `organization_id` NULL: **0** de 2876.
- 2875 fichas en `d23d88ee-944a-4f0d-9060-f0ad9f76f092`; 1 ficha en `0be5025a-0302-4ce9-b146-ea886a204c39` (1 marca aprobada, 2 `brand_influencers`) → caso de tenant mixto.
- `d23d88ee…` ya aloja: 100 suscripciones, 28 pagos Pro, 61 affiliate links, 32 tickets, 17 campañas, 10 facturas, 10 bookings, 2 contratos y el único super_admin.
- 53 organizaciones sin marca ni fichas (sin acción).
- Dependencias de `influencers` en producción: 11 políticas RLS de otras tablas la consultan; única edge function (`sync-engagement`) no la toca.

## 2. Candidatas (sin elegir)
| Organización | Fichas | Marcas | Observación |
|---|---|---|---|
| `d23d88ee-…f092` | 2875 | ver nota | Contenedor de hecho; también aloja operaciones de plataforma y el super_admin. Para v2 debe tener 0 marcas (el trigger `INFLUENCER_TENANT_CANNOT_HOST_BRANDS` bloquearía). Verificar su conteo de marcas antes de designarla. |
| `0be5025a-…4ce9` | 1 | 1 aprobada | No apta como contenedor (tiene marca). |

## 3. Comparación
| Eje | v2: organización designada (`influencer_tenant`) | E: propiedad por `influencer_id`, org nullable |
|---|---|---|
| Pro / PayPal | Sin cambio de código: `organization_id` NOT NULL se mantiene | Reescribir checkout, complete y webhook; migrar NOT NULL |
| Afiliados / tickets | Sin cambio | Cambiar filtros admin y esquemas (61 links, 32 tickets) |
| Campañas / contratos | Sin cambio | Reescritura de relaciones y RLS |
| Permisos | Una sola org sin marcas: ningún brand_manager hereda acceso; trigger impide mezclar | Más fino, pero toda RLS y `getOrgId` cambian |
| Mantenimiento | Un índice único + trigger + una función | Superficie grande, migración de datos |
| Reversibilidad | Alta (reversión comentada en la propuesta) | Baja |
| Riesgo de datos | Ninguno: no reasigna filas | Backfill de ~10 tablas |
**Recomendación:** v2, tras decidir la organización y manejar la ficha de `0be5025a…`. E solo si se quiere eliminar el concepto de tenant a largo plazo.

## 4. Qué no se hizo
Sin escrituras, migraciones, commit, push, merge ni deploy; `p4conc` y revocación de privilegios de token sin ejecutar; migraciones `20261022160000` y `20261022150000` separadas y sin aplicar.
