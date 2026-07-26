# Verificación: visibilidad de influencers en portal Marca

## Regla de producto

- **Pro** puede explorar el catálogo completo de influencers.
- **Basic y Growth** solo reciben influencers que postularon a campañas de su propia marca.
- No se incluyen roster privado, invitaciones privadas, solicitudes rechazadas ni influencers de otras marcas.

## Controles en servidor

1. `GET /api/brand/influencers` resuelve la marca con `resolveBrandAccess(user.id)`; no acepta `brand_id` desde cliente.
2. La consulta restringida toma primero las campañas propias o colaboradoras de esa marca y luego filtra `campaign_influencers.application_status IN ('pending', 'accepted')`.
3. `GET /api/influencers` exige una fila activa de `organization_members` con `role = 'super_admin'`; no usa metadatos de JWT para autorizar.

## Prueba reproducible

Con sesiones independientes para dos marcas y un administrador:

| Caso | Request | Resultado esperado |
| --- | --- | --- |
| Marca Basic/Growth A | `GET /api/brand/influencers` | Solo postulantes pendientes/aceptadas de campañas A. |
| Marca B | `GET /api/brand/influencers` | Nunca recibe postulantes de A. |
| Marca sin postulaciones | `GET /api/brand/influencers` | `200` con `data: []`. |
| Usuario de marca contra catálogo global | `GET /api/influencers` | `403 Forbidden`. |
| Administrador SCENCE | `GET /api/influencers` | `200` con catálogo administrativo. |
| Marca Pro | `GET /api/brand/influencers` | `200` con catálogo completo, sin PII privada. |

## Límites

La verificación E2E requiere dos sesiones reales y datos de prueba redactados en un entorno Preview. No se deben registrar tokens, cookies ni datos personales en esta evidencia.
