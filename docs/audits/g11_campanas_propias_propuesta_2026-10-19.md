# G-11 — Campañas propias de la influencer: propuesta mínima (2026-10-19)

**Estado: PROPUESTA, NO DECISIÓN.** G-11 sigue abierto y requiere decisión de producto de la fundadora. Este documento no cambia KPI, facturación ni reportes.

## Pregunta pendiente

¿La influencer crea una campaña para **organizar sus propias colaboraciones** (seguimiento personal) o una **campaña comercial dentro de SCENCE**?

## Qué hace hoy el código (hechos, lectura estática 2026-10-19; no verificado en ejecución ni en producción)

- `POST /api/influencer/my-campaigns` crea la campaña con `status='active'`, `type='sponsored_post'`, `created_by = user.id` y `organization_id` = organización de la influencer.
- Crea también `campaign_influencers` con `application_status='accepted'` (sin aprobación de admin).
- El marketplace las excluye (`campaigns/open`, `campaigns/[id]`, `campaigns/[id]/apply`: `created_by` contra `influencers.user_id`).
- No existe marca asociada en el flujo de la UI (el formulario no envía `brand_id`).

## Propuesta mínima (recomendación provisional)

Tratarla como **campaña propia de seguimiento**, separada de las campañas comerciales aprobadas por SCENCE, hasta que se decida otra cosa:

1. **No es una campaña comercial aprobada.** Que esté `active` y con la influencer `accepted` solo significa "puede operarla ella"; no implica revisión ni aprobación de SCENCE ni de una marca.
2. **No es ingreso de SCENCE.** No debe sumar a ingresos, facturación ni pagos mientras G-11 siga abierto.
3. **No pertenece a ninguna marca.** `brand_id` queda siempre en `null` (cambio de esta fase) y la influencer no puede cambiarlo.
4. **Sin autoaprobación.** La influencer solo puede pausar, completar o cancelar su campaña; no puede dejarla en `active`, `draft` ni `pending_approval` por API (cambio de esta fase).
5. **Identificación estable.** Una campaña propia es la que cumple `created_by = influencers.user_id`. Es la misma regla que ya usa el marketplace; no se crea columna ni estado nuevos.

## Pendiente de decidir (no se toca en esta fase)

| Tema | Pregunta | Dónde se vería afectado |
|---|---|---|
| KPI del dashboard admin | ¿Las campañas propias cuentan en «campañas en curso» / «completadas»? Hoy `organization_id` puede ser el de la agencia (por verificar). | Dashboard, analytics |
| Facturación / pagos | ¿Pueden generar factura o pago? Propuesta: no. | Billing |
| Reportes | ¿Aparecen en reportes de campaña y de influencer? | Reportes |
| Datos existentes | ¿Hay campañas propias con `brand_id` ya asignado? Se averigua con una consulta de solo lectura, que requiere autorización. | Base de datos |
| Plan Pro | ¿Crear campañas propias requiere Pro? | Producto / ventas |

## Siguiente paso

Decisión de la fundadora sobre la pregunta de G-11. Después, y solo después, evaluar el impacto en KPI, facturación y reportes con una auditoría propia.

## Verificaciones pendientes (estado 2026-10-19)

| Verificación | Estado | Cómo cerrarla |
|---|---|---|
| `npx tsc --noEmit` | Ejecutado: sin errores | — |
| `npm test` | Ejecutado: 342/342 | — |
| `next lint` (2 archivos tocados) | Ejecutado: sin avisos | Lint completo: `npx next lint` |
| `next build` | **No ejecutado** (bloqueado en el entorno de trabajo: el binario SWC de `node_modules` es de macOS y el entorno es Linux arm64) | Ejecutar `npx next build` en la propia Mac de la fundadora (donde se instaló `node_modules`), o dejar que Vercel lo confirme al desplegar. No se cambió ninguna dependencia ni configuración para eludirlo. |
| Prueba con base de datos (criterios 2, 4 y 6 de la auditoría) | **Bloqueado** | Requiere una rama de Supabase aislada, con datos y migraciones sanas. A 2026-10-19 las dos ramas existentes están en `MIGRATIONS_FAILED` y sin datos (`with_data=false`). |
| Campañas propias con `brand_id` ya asignado | **Sin consultar** | Consulta `SELECT` de solo lectura; requiere autorización específica porque la única base con datos es producción. |
| Efecto de `organization_id` en KPI | **Pendiente** | Auditoría propia tras decidir G-11. |
