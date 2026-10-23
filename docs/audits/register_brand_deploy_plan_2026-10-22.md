# register_brand — revisión, concurrencia, despliegue y reversión (2026-10-22)

Estado: **nada aplicado en producción**. Migración aplicada solo en la rama de pruebas `dexpvoubiklgotuukrml` (rama no predeterminada; padre = producción `xzzbishzfyovrladcaeb`). Sin commit, push ni deploy.

## 1. Hechos verificados

| Qué | Resultado |
|---|---|
| Concurrencia real (Postgres 16 local desechable, migración exacta, 12 sesiones simultáneas × 25 rondas × 6 escenarios) | 0 desvíos. 400 marcas, 400 organizaciones, 0 huérfanas, 0 slugs ni claves duplicadas, todas `pending_approval`, el registrante no recibe membresía. |
| Control negativo (misma prueba sin `pg_advisory_xact_lock`) | **Falla 10/10** en «mismo correo, claves distintas» (12 marcas creadas con el mismo correo). La prueba sí detecta el problema. |
| ACL de la función en la rama | `service_role` y `postgres` únicamente; no `SECURITY DEFINER`; `anon`/`authenticated` sin EXECUTE. |
| `npm test` / `tsc` / `git diff --check` | 431/431 · sin errores · limpio |

Limitación honesta: la prueba corre sobre un **esquema réplica** (no la rama real) porque instalar `pg_cron` y usar credenciales de servicio en la rama fue denegado. Cubre el comportamiento de la función y de los índices únicos reproducidos; no cubre otras restricciones o disparadores de producción. El script `scripts/test-register-brand-concurrency.mjs` (rama real, necesita clave de servicio de la rama y rechaza producción) sigue sin ejecutarse.

## 2. Revisión del SQL

- **Idempotencia:** clave (`metadata->>'registration_key'`, índice único parcial) y dueño (`brands_user_id_unique`). Reintento → `replayed` con la misma marca y organización.
- **Serialización:** bloqueos consultivos en orden fijo clave → dueño → correo → Instagram (sin deadlocks). Defensa en profundidad con índices únicos: clave, `user_id`, Instagram, slug.
- **Punto débil real:** la unicidad de **correo** depende solo de los bloqueos (no hay índice único; es P1). Cualquier otro escritor (edición administrativa, scripts) puede crear duplicados. Control negativo lo confirma.
- **Reversión de errores:** bloque con excepción → si falla la inserción de la marca se deshace la organización (0 huérfanas incluso con fallo a mitad, 25/25).
- **Lista de columnas:** se excluyen `id`, `organization_id`, `user_id`, `created_by`, `status`, fechas, `subscription_plan_override`, `metadata`. `brands` no tiene columnas de aprobación; `referred_by_influencer_id` se permite a propósito.
- **Mejora opcional (no aplicada):** `set search_path = public, pg_temp`. Índice funcional sobre `lower(contact_email)` solo si crece la tabla (hoy ~70 filas).
- **Riesgo del índice nuevo:** `create unique index` toma un bloqueo breve de escritura sobre `brands`; con ~70 filas es despreciable. Ninguna fila actual tiene `registration_key`, así que no puede fallar por datos existentes.
- **Reversión:** `drop function public.register_brand(jsonb, uuid, text, uuid, jsonb); drop index if exists public.brands_registration_key_unique;` — sin pérdida de datos (las marcas creadas conservan su `registration_key` inofensivo en `metadata`).

## 3. Fallback no atómico: eliminado

Antes, si la función no existía, `registerBrandAtomic` creaba organización y marca en dos pasos; un fallo en el segundo dejaba una organización huérfana. Ahora **falla cerrado** (`register_brand_unavailable`, sin crear nada). Consecuencia de despliegue: **aplicar la migración antes que el código**. La migración es aditiva: el código actualmente desplegado sigue funcionando con ella aplicada.

## 4. `brand.manage` (verificado)

- Solo el rol `owner` (`organization_members.is_owner`) lo tiene; `brand_manager`, `member` y `finance` no.
- Se evalúa sobre la marca resuelta de **ese** usuario (`resolveBrandAccess`); no existe ruta que lo aplique a otra marca.
- No es administración global: `isPlatformAdmin` es independiente (`super_admin`) y `brand-permissions.ts` no lo menciona.
- Registrar **no crea membresías** (el RPC se llama sin `ownerUserId`; solo `ensureBrandRow` lo pasa) — probado estáticamente y en la prueba concurrente.
- Efecto práctico: una marca nueva registrada por un owner aprobado queda `pending_approval`, sin dueño hasta que alguien se autoregistre con ese correo.

## 5. Marcas pendientes (decisión 2026-10-22)

Pendiente: perfil, estado, onboarding (plan y documentos legales) y **consulta** de facturación. No: emitir/editar/pagar facturas (`billing_manage`), campañas ni funciones operativas. Aprobada: todo según rol/plan. Suspendida: estado y facturación (consulta y gestión para resolver obligaciones). Rechazada: solo estado. Aislamiento entre marcas sin cambios.

## 6. Hallazgo: tokens de Google en `organizations`

- **Hecho:** `organizations` tiene `google_access_token`, `google_refresh_token`, `google_token_expiry`, ids de Stripe y `settings`. Ningún código de la aplicación usa los tokens (solo `docs/DATA_DESIGN.md`).
- **Hecho:** `GET/PATCH /api/settings/organization` devolvía `select('*')` / `select()` → tokens y datos de Stripe al navegador de cualquier miembro con `brand.read` (y de admins). **Corregido localmente**: lista explícita de columnas (test).
- **Hecho (rama de pruebas):** `authenticated` tiene `SELECT` de tabla sobre todas las columnas y la política `organizations_select_member` deja a cualquier miembro activo leer la fila de su organización → un miembro puede leer los tokens **con su propio JWT** (PostgREST), sin pasar por las rutas. Escritura bloqueada (sin políticas). `anon` tiene el privilegio pero ninguna política.
- **Rama de pruebas:** 0 de 82 organizaciones con tokens o ids de Stripe.
- **Producción (consulta de solo lectura autorizada el 2026-10-22, solo conteos):** 125 organizaciones; **0** con `google_access_token`, **0** con `google_refresh_token`, **0** con `google_token_expiry`, **0** con ids de Stripe. Mismo exposición de esquema que la rama (SELECT de tabla para `authenticated`, política `organizations_select_member`, RLS activo) pero sin datos que exponer. No hay nada que rotar.
- **Propuesta (no aplicada):** `docs/audits/PROPUESTA_organizations_token_privileges_2026-10-22.sql` (revocar SELECT de tabla y conceder solo columnas no sensibles). Su verificación en transacción con reversión fue denegada; probar en la rama con tu OK.
- **Si producción tiene tokens con valor:** rotarlos/revocarlos en Google primero.
- **Otro hallazgo, no modificado:** `GET/PATCH settings/organization` siguen sin exigir admin cuando el usuario no tiene acceso de marca (cae a `getOrgId`); `ensureInfluencerRow` y `/api/influencers` toman «la organización más antigua» como SCENCE, lo que contradice la regla «ninguna marca tiene privilegios por su nombre/antigüedad».

## 7. Filas de prueba `p4conc` en la rama (solo identificadas)

| Marca | id | Organización |
|---|---|---|
| p4conc Uno | afa991d0-cd3d-47dc-878d-aae564730ebc | 29478253-af51-4152-80ff-135e4212cf24 (`p4conc-uno`) |
| p4conc Dos | b1d13e82-b367-4039-b5d2-8d24c8d9e2cd | fc1facbf-fe4b-4d83-88a0-34677021f4da (`p4conc-dos`) |
| p4conc Tres | 168087b7-5e08-4fd7-be35-f9012e2bb99f | 7a654f81-1037-4afe-9dfb-b8a585149ce9 (`p4conc-tres`) |

Verificado: 0 membresías y 0 campañas en cada una; creadas por `8190c816-aebf-41cb-8414-aec348797a67` el 2026-10-22; claves `p4conc-uno|dos-1|tres`. No se tocaron.
Operación propuesta (**no ejecutada**, pendiente de tu autorización): `docs/audits/PROPUESTA_archivar_filas_p4conc_2026-10-22.sql`. Archiva en vez de borrar (marca → `rejected` con `metadata.test_row`; organización → `is_active=false`), en una transacción que **aborta si no son exactamente 3 y 3**, con filtros por id + nombre + estado + creador + `user_id` nulo, huella previa/posterior del resto de las tablas y reversión. Dependencias verificadas: 0 filas en las 16 tablas que referencian `brands` y las 28 que referencian `organizations`.

## 8. Plan de despliegue (conforme a CLAUDE.md §11, §17 y §18)

**Niveles (§18):** Implementado ✔ · Probado en local ✔ (tests, concurrencia en Postgres local) · Verificado en Preview ✘ **Por verificar** · Confirmado en producción ✘ **Por verificar**. `next build` (§16.7): **Por verificar** (pendiente de ejecutar).

Cada paso con efecto externo requiere **autorización explícita y separada** (commit, push, merge, deploy y migración no se extienden entre sí). Producción permanece en **solo lectura** hasta entonces; no se escribe ningún dato de prueba en producción.

0. Sin autorización aún: ninguno de los pasos siguientes se ejecuta.
1. Revisión de la fundadora de este diff y de la migración (Regla Cero: permisos, ownership, datos de marcas).
2. Validación final local: `npm test`, `tsc`, `next lint`, `next build` (con fuente simulada si el sandbox no sale a fonts.googleapis.com) y revisión del diff. Smoke tests en `localhost:3000` confirmando antes a qué base apunta el entorno (solo el ref, sin claves).
3. Antes de tocar producción: identificar registros exactos, previsualizar y revisar dependencias; respaldo/rama con datos. Consulta de solo lectura de tokens de Google (§6) si la autorizas.
4. Con autorización de migración: aplicar `20261022160000` (aditiva) **antes** del código; verificar existencia de la función, ACL y el índice. Sin pruebas que escriban datos reales.
5. Con autorización de commit/push/deploy: Preview primero; los smoke tests de escritura solo en base aislada. Producción solo tras aprobación.
6. Después, con aprobación aparte: P1, P2, privilegios de tokens, P5–P8.

**Reversión:** código → redeploy del anterior (la migración sigue siendo compatible). Base → `drop function …; drop index …;` (§2). Ninguna fila existente se modifica.

**Revisión de seguridad registrada (§18):** rutas afectadas (brands, brand/brands, influencer/owned-brands, campaigns, crm-leads, invoices, settings/organization), chequeo de permisos en backend (`hasBrandPermission` sensible al estado, `authorizeBrandRegistration`), RLS de `organizations` revisada (sin cambios aplicados), casos de otros roles cubiertos en `tests/brand-status-and-registration.test.ts`.

## 9. Revisión final (2026-10-22, tarde)

### 9.1 SQL de archivado `p4conc` (v2, NO ejecutado)
Reescrito con: transacción única + `lock_timeout`; precondiciones (3 marcas por id+nombre+estado+creador+`user_id` nulo+clave; 3 pares marca→organización exactos; 3 organizaciones activas `p4conc-*`; ninguna marca ajena dentro); recorrido de **todas** las FK hacia `brands`/`organizations` exigiendo 0 filas; huella md5 y totales del resto **antes y después** dentro de la misma transacción; exactamente 3+3 filas actualizadas o aborta; reversión con la misma garantía. Probado **solo en Postgres local desechable**: camino feliz, reversión y 8 casos que abortan sin cambios (dependencia por membresía, por campaña, marca ajena, creador distinto, marca aprobada, marca con usuario, par cruzado, organización inactiva): 24/24 OK con las pruebas de la migración 150000 (`scripts/test-p4conc-archive-and-membership-sync-local.mjs`). En la rama real: no ejecutado; sin disparadores sobre `brands.status/metadata`; `organizations.trg_updated_at` solo toca `updated_at` de esas 3 filas.

### 9.2 `settings/organization` — control de autorización
- **Hecho (código):** `GET`/`PATCH` solo comprueban permiso `if (brandAccess && …)`. Si `resolveBrandAccess` devuelve `null` (p. ej. miembro de una organización con varias marcas y sin `brand_id`, o sin marca) el chequeo se omite y `getOrgId` entrega **su** organización: podría leer o editar nombre, NIF y correo de facturación sin ser admin. Quienes la llaman hoy: solo `admin-settings/organization` (UI de admin).
- **Hecho (rama):** roles activos en `organization_members`: `super_admin` 2, `brand_manager` 2, `member` 1; ningún otro rol.
- **No corregido: afecta permisos → requiere tu aprobación específica.** Parche listo y verificado con `tsc` (restaurado después): `docs/audits/PROPUESTA_settings_organization_authz_2026-10-22.patch` — exige admin de plataforma, o acceso de marca con `brand.read`/`brand.manage` y opera sobre `brandAccess.organizationId`.

### 9.3 «La organización más antigua es SCENCE» (2 lugares)
- `ensureInfluencerRow` (`ensureOrg.ts`) **asigna** esa organización a las influencers nuevas (escritura de datos); `api/influencers/route.ts` solo la usa para rotular `registered_by='SCENCE'` (lectura).
- **Hecho (rama):** la organización más antigua es `Scence SpA` (tipo `agency`, 150 de 153 influencers), pero las organizaciones de los 2 `super_admin` son **otras** (una es la «gmail» huérfana). En la rama el criterio «más antigua» no coincide con «donde está el equipo de plataforma».
- **No corregido:** no hay criterio inequívoco para sustituirlo y el nombre/identidad de SCENCE SpA está pendiente por tu instrucción. Cambiarlo modifica a qué organización pertenecen las influencers nuevas. **Decisión necesaria:** designar la organización de plataforma de forma explícita (p. ej. variable de configuración con el id, o una columna dedicada), con migración y verificación previa del dato en producción.

### 9.4 Migraciones y orden
| Migración | Qué hace | Depende de | ¿Aplicada? |
|---|---|---|---|
| `20261022150000_preserve_brand_member_role_sync` | `create or replace` de `ensure_brand_member_org_membership`: `member` deja de promoverse a `brand_manager`; no degrada owner ni super_admin. No reescribe filas. | `20261004184849` (función+trigger), enum `user_role` con `member`/`finance`, `brand_members` | **No** (la función de la rama es la versión anterior) |
| `20261022160000_register_brand_atomic` | índice único parcial + función `register_brand` (solo `service_role`). | `trg_ensure_brand_owner_org_membership` (`20261004184849`), índices `brands_user_id_unique` e Instagram único (`20260812…`), CHECK de `status`, columnas de `brands` | Solo en la rama de pruebas (como 2 migraciones) |
- **Independientes entre sí.** Orden recomendado: `160000` primero (es lo que el código nuevo exige), `150000` aparte (cambia permisos de futuros miembros → aprobación específica).
- **150000, probada en Postgres local:** muestra el defecto previo (member→brand_manager; owner degradable), es idempotente y tras aplicarla member sigue member y owner/super_admin no se degradan. Riesgo: afecta solo altas/updates futuras de `brand_members`; las asignaciones históricas incorrectas **no** se corrigen (requiere migración de datos auditada, no incluida).
- **Estado de la base remota:** pendientes además `20261012230000`, `20261021120000`, `20261022120000` (comparación completa repo↔base sin hacer). No bloquean a `160000`.
- **Reversión:** 160000 → `drop function …; drop index …;`. 150000 → reponer la definición anterior de la función (texto en la rama/`20261004184849`).

### 9.5 Concurrencia en rama aislada
Runbook: `docs/audits/concurrency_branch_runbook_2026-10-22.md` (script con barreras: rechaza producción y exige `CONFIRM_BRANCH_REF`).
