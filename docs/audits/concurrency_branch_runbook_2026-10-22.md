# Cómo demostrar la concurrencia de `register_brand` en una rama aislada (2026-10-22)

**Regla:** nunca producción (`xzzbishzfyovrladcaeb`). Sin claves en el chat. Sin borrados: las filas de prueba se archivan.

## 0. Prerrequisitos (comprobables)
1. La rama existe, **no es la predeterminada** y su `parent_project_ref` es producción: `list_branches` → `is_default:false`. Hoy sirven `dexpvoubiklgotuukrml` y `slflkyynhadmnvbbucag`.
2. La migración `20261022160000` está aplicada **en esa rama** (`list_migrations`; en la rama actual figura como `register_brand_atomic` + `register_brand_atomic_owner_flow`).
3. Existe al menos un usuario en `auth.users` de la rama (se usa como `REGISTERED_BY`). Ya hay uno: `8190c816-aebf-41cb-8414-aec348797a67`.
4. Línea base de huérfanas, para no confundir las históricas con las de la prueba: `select count(*) from organizations o where type='brand' and not exists (select 1 from brands b where b.organization_id=o.id);` (rama actual: 2 organizaciones «gmail» del 21-oct).

## 1. Método recomendado — script contra la rama real
`scripts/test-register-brand-concurrency.mjs` (N llamadas simultáneas por HTTP, cada una en su propia conexión del pooler).

```
SUPABASE_URL=https://<ref-rama>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<clave de servicio DE LA RAMA, copiada del panel por la fundadora> \
REGISTERED_BY=<uuid existente en la rama> \
CONFIRM_BRANCH_REF=<ref-rama> CONCURRENCY=10 \
node scripts/test-register-brand-concurrency.mjs
```
Barreras del script: rechaza la URL de producción; exige `CONFIRM_BRANCH_REF` igual al ref de la URL; prefija todo con `p4conc-<timestamp>`; al final **archiva** (`status='rejected'`), no borra.

## 2. Criterios de aceptación (todos deben cumplirse)
| Escenario | Esperado |
|---|---|
| N llamadas, misma clave | 0 errores; 1 `created` + N−1 `replayed`; 1 marca y 1 organización |
| N llamadas, claves distintas, mismo correo | 1 `created` + N−1 `conflict` |
| Tras la prueba | marcas = organizaciones de la prueba (0 huérfanas nuevas); línea base sin cambios |

Registrar en la entrega: ref de la rama, fecha, N, salida completa del script y la consulta de huérfanas antes/después.

## 3. Alternativa solo-SQL (requiere aprobación específica)
Sesiones simultáneas desde la propia base necesitan una extensión que hoy **no** está instalada en la rama (`pg_cron` o `dblink`). Instalarla es un cambio de esquema/persistencia, así que solo con tu autorización explícita y retirándola al terminar (`drop extension`). Con `pg_cron`: programar N trabajos idénticos a «1 seconds», que cada uno llame a `register_brand`, volcar el resultado a una tabla temporal de la prueba, `cron.unschedule` y `drop extension`. No se usó.

## 4. Evidencia ya obtenida (sin rama)
Postgres 16 local desechable con la migración exacta sobre un esquema réplica: 12 sesiones × 25 rondas × 6 escenarios, 0 desvíos, 0 huérfanas; control negativo sin bloqueos falla 10/10 (`scripts/test-register-brand-concurrency-local.mjs`). **No sustituye** la prueba en la rama real: no cubre otras restricciones o disparadores de la base de producción.

## 5. Después de la prueba
Archivar las filas con el procedimiento de `PROPUESTA_archivar_filas_p4conc_…sql` (adaptando IDs) solo con autorización. Nunca `delete`.
