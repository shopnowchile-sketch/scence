# Cierre de etapa — signup, RLS de influencers, rutas `getOrgId`, settings y migraciones (2026-10-22)

Modelo: organización técnica = una marca. SCENCE es la plataforma. Scence SpA es una marca de prueba sin privilegios (ni por nombre, antigüedad o posición).
Niveles: **Implementado en local** · **Probado en local** · **Verificado en Preview: NO** · **Confirmado en producción: NO**.

## 1. `handle_new_user` (propuesta, no aplicada)
- Hoy (definición vigente `20261005170000`): busca `type='agency' AND lower(trim(name))='scence spa'` (más antigua si hay varias; la rama de pruebas tiene «Scence SpA» y «SCENCE SPA») y asigna `organization_id` a toda influencer nueva; si no existe, **aborta el registro** (`SCENCE_MAIN_ORG_NOT_FOUND`).
- Propuesta `PROPUESTA_handle_new_user_sin_scence_spa_2026-10-22.sql`: ficha previa (mismo correo, `user_id` nulo) **conserva su organización**; autorregistro sin ficha → `organization_id` NULL; sin excepción. Nada inventado.
- **Bloqueante de negocio:** `subscriptions.organization_id` es NOT NULL y estas rutas exigen `influencers.organization_id`: `influencer/paypal/checkout` (409), `paypal/complete` (403), `paypal/webhook`, `influencer/affiliate`, `influencer/my-campaigns` (campaña propia, 400). Con NULL, una influencer nueva no podría contratar Pro. Decisión pendiente: ¿en qué organización viven los registros comerciales de una influencer autorregistrada? No se resuelve con organización «de plataforma» ni variable de entorno.
- Probado en Postgres local (20 casos, `scripts/test-handle-new-user-and-rls-local.mjs`): defecto actual reproducido; versión nueva sin asignación por nombre, con conservación de organización previa, sin crear organizaciones.

## 2. RLS `influencers_org_read` (propuesta, no aplicada)
- Hallazgo (lectura en la rama de pruebas `dexpvoubiklgotuukrml`): una sola política `cmd=ALL`, `roles={public}`, `USING (organization_id IN (membresías activas) OR organization_id IS NULL)`; `anon` y `authenticated` tienen SELECT/INSERT/UPDATE/DELETE/TRUNCATE. **Una ficha sin organización es legible y modificable/borrable con la clave pública, sin sesión.** Reproducido en Postgres local.
- Datos: rama de pruebas 152 fichas, 0 sin organización (150 en «Scence SpA», 1 «SCENCE (prueba)», 1 «SCENCE SPA»; ninguna de esas organizaciones tiene marca). **Producción no medida** (no autorizada); consulta lista al final de `PROPUESTA_rls_influencers_2026-10-22.sql`.
- Propuesta `PROPUESTA_rls_influencers_2026-10-22.sql`: elimina la política; crea lectura y escritura solo para miembros activos de la organización, sin cláusula NULL y solo `authenticated`. No borra ni reasigna datos. Las rutas del producto usan service-role y no dependen de la política. Aparte (privilegios, requiere aprobación): `revoke all … from anon` y quitar TRUNCATE/TRIGGER/REFERENCES a `authenticated`.
- Probado en Postgres local: anon no lee ni modifica; miembro A solo ve/escribe A; sin membresía nada; 3 fichas intactas.

## 3. Las 17 rutas con `getOrgId` sin comprobación de rol (corrección de la lista previa)
`getOrgId` devuelve la primera membresía activa de cualquier rol (member/finance incluidos). Las 12 rutas siguientes solo se llaman desde pantallas `/admin-*` (el layout del dashboard exige `isPlatformAdmin`) → **guarda `isPlatformAdmin` → 403** (patrón ya usado en `influencers/merge` y `delete-no-instagram`). Solo restringe; no amplía.

| Ruta | Operaciones | Rol requerido | Riesgo previo | Estado |
|---|---|---|---|---|
| `affiliates` | GET, POST | super_admin | member/finance lee y crea enlaces de afiliado de su org | Guardada y probada |
| `affiliates/[id]` | GET, PATCH, DELETE | super_admin | idem (edita/borra) | Guardada y probada |
| `affiliates/[id]/conversions` | GET, POST | super_admin | registra conversiones/comisiones | Guardada y probada |
| `affiliates/settlements` | GET, POST | super_admin | crea liquidaciones de comisión (dinero) | Guardada y probada |
| `affiliates/settlements/[id]` | PATCH | super_admin | cambia estado de pago | Guardada y probada |
| `events`, `events/[id]`, `/tickets`, `/sales` | GET/POST/PATCH/DELETE | super_admin | crea, cancela eventos, vende tickets | Guardada y probada |
| `influencers/bulk` | POST | super_admin | importa hasta 1500 fichas | Guardada y probada |
| `influencers/duplicates` | GET | super_admin | expone fichas con datos personales | Guardada y probada |
| `campaigns/ai-build` | POST | super_admin | gasta créditos de IA y crea campaña; la guarda va **antes** de llamar a Claude | Guardada y probada |

No modificadas (con motivo):
| Ruta | Motivo | Propuesta (pendiente de aprobación) |
|---|---|---|
| `locations` | POST ya exige admin (`authorizeLocationsAdmin`); GET es lectura de geografía | Sin cambio (estaba mal listada) |
| `tickets`, `tickets/[id]` | `SupportPage` es compartida admin/marca: debe usar permiso de marca, no solo admin | Permiso `brand.read` para listar/crear y `brand.manage` para editar/borrar tickets de la marca; admin ve todo |
| `brand/brands` | Portal de marca; GET lista las marcas registradas por esa marca | `resolveBrandAccess` + permiso explícito; POST ya usa `authorizeBrandRegistration` |
| `influencers/communes` | Lectura de comunas; `InfluencerFilters` puede estar en componentes compartidos | Verificar consumidores antes de restringir |
Pruebas: `tests/getorgid-admin-guards.test.ts` (14): 403 para brand_manager/member/finance, 401 sin sesión, super_admin no recibe 403, guarda antes de `getOrgId` y antes de `callClaude`.
Alcance real de la revisión: `getOrgId` aparece en 67 archivos de `src/app/api`; 40 no usan ninguno de los ayudantes de autorización reconocidos (`resolveBrandAccess`, `hasBrandPermission`, `isPlatformAdmin`, etc.). De esos 40: 12 quedaron guardados (arriba); `locations` ya tenía guarda propia. **Sin ninguna comprobación 403 detectable** (además de `communes`, `tickets`, `tickets/[id]`): `campaigns/[id]/influencer-report`, `me/role`, `navigation/summary` (probablemente solo lectura del propio usuario; por confirmar). Los ~20 restantes (`admin/*`, `analytics`, `bookings`, `payroll`, `contracts/[id]`, `dashboard`, `influencers/[id]/pro`, `ranking`, `sync-instagram`, `brands/*`, etc.) tienen alguna comprobación ad hoc (403/`authorize*`) que **no se revisó línea por línea** en esta etapa: queda como pendiente.

## 4. `settings/organization` con varias membresías de administración
Antes: 409 sin más. Ahora: 409 con `code: ORGANIZATION_SELECTION_REQUIRED` y la lista `{id, name}` solo de SUS organizaciones; la pantalla `/admin-settings/organization` muestra un selector y reintenta con `?organization_id=`; el PATCH también viaja con el `organization_id` elegido. Nunca se elige por antigüedad. Probado: lista correcta, elección válida 200, ajena 403.

## 5. Migraciones (no aplicadas en ningún entorno remoto)
| | `20261022160000_register_brand_atomic` | `20261022150000_preserve_brand_member_role_sync` |
|---|---|---|
| Efecto | Crea índice único `brands_registration_key_unique` y la función `register_brand(...)` (SECURITY DEFINER, solo `service_role`): crea organización + marca `pending_approval` en una transacción, idempotente, con advisory locks. | Reemplaza `ensure_brand_member_org_membership()`: un `member` ya no sube a `brand_manager`; nunca degrada a owner/super_admin. |
| Datos existentes | No modifica ninguna fila | No reescribe filas; solo cambia el mapeo futuro |
| Depende de | Trigger `trg_ensure_brand_owner_org_membership`, índices únicos user_id/instagram, CHECK de estado | Migración `20261004184849` |
| Riesgo | Aditiva. El código nuevo **falla cerrado** (`register_brand_unavailable`) si la función no existe: **la migración debe ir antes del deploy** | **Cambia permisos** (futuras altas de `member`/`finance`): requiere aprobación específica; historiales ya promovidos requieren migración de datos auditada aparte |
| Reversión | `drop function public.register_brand(jsonb, uuid, text, uuid, jsonb); drop index if exists public.brands_registration_key_unique;` | Reaplicar versión anterior de `20261004184849` |
| Orden | **1.º** | **2.º**, por separado y con su propia aprobación |
Son independientes entre sí. Probadas en Postgres local; en la rama real solo está aplicada la variante de `register_brand` (la concurrencia **no** se ha demostrado en una rama real: solo Postgres local).

## 6. Sin ejecutar
Archivado `p4conc` (propuesta v2) y revocación de privilegios de tokens en `organizations`: sin cambios.

## 7. Pendientes que requieren aprobación
1) Decisión de negocio sobre la organización de registros comerciales de influencers autorregistradas (bloquea la migración de `handle_new_user`). 2) Aplicar RLS de `influencers` (+ revocar `anon`) tras medir fichas NULL en producción. 3) Guardas de marca en `tickets`, `brand/brands`. 4) Migraciones 160000 y 150000. 5) Revisar línea por línea las rutas restantes con `getOrgId` (ver alcance en §3).

## 8. Validaciones locales (2026-10-22)
`npm test` 460/460 · `tsc --noEmit` 0 errores · `next lint` 0 errores (solo advertencias previas) · `git diff --check` limpio · `next build` OK (EXIT 0) en el entorno en la nube con una copia del código SIN archivos `.env*`, variables Supabase ficticias y sin `docs/`; no valida integración con la base real. Postgres local: 20/20 (signup + RLS). Preview y producción: no verificados.

## 9. Auditoría de rutas, ronda 2 (2026-10-22, tarde)
Probadas en `tests/route-access-audit.test.ts` (7 pruebas, base en memoria, sin red).
| Ruta | Operación y contexto | Permiso exigido ahora | Cambio |
|---|---|---|---|
| `tickets`, `tickets/[id]` (5 handlers) | Panel de admin (`SupportPage adminMode`); marcas e influencers usan `/api/support` | `isPlatformAdmin` | Guardada |
| `tickets/[id]/replies` | Admin de la organización del ticket o **dueño del ticket** | ya correcto | Sin cambio |
| `brand/brands` GET | Listado de marcas creadas por mí y colaboradoras de MIS campañas | admin de plataforma, o `campaign.read` + marca en estado operativo (aprobada); organización sale de la marca resuelta, no de «la primera membresía» | Guardada (finance, pendiente, rechazada, sin marca, influencer: 403) |
| `brand/brands` POST | Registrar marca | `authorizeBrandRegistration` (ya) | Sin cambio |
| `influencers/communes` | Catálogo oficial de comunas (sin datos de ninguna marca) | solo sesión | Se retiró un `getOrgId` sin uso |
| `campaigns/[id]/influencer-report` | Informe con email/teléfono de la influencer; solo se llama desde admin | admin, o `report.read` + campaña de SU marca + influencer participante de ESA campaña | Guardada (antes: cualquier miembro del org y **cualquier id de influencer**) |
| `me/role`, `navigation/summary` | Datos del propio usuario / contadores acotados a su organización (global solo `super_admin`) | sesión + alcance propio | Sin cambio (nota: `me/role.isAdmin` es true también para owner de marca: es solo bandera de interfaz; con varias membresías devuelve la «primera») |
| **`POST /api/influencers`** | Crear ficha; solo la usa `/admin-influencers/new` | `isPlatformAdmin`; organización: del cuerpo solo si es una de SUS organizaciones, si no la suya; ya no se toma de `user_metadata` | **Hallazgo grave corregido:** antes cualquier usuario con sesión creaba fichas en cualquier organización |

Las ~20 rutas restantes con control propio (revisadas leyendo su comprobación de acceso, no todo su cuerpo):
- **Protegidas con `super_admin` real** (`getUserRole(...).isAdmin`; `getOrgId` prioriza la membresía de plataforma): `admin/brand-users`, `admin/collaboration-applications/[id]`, `admin/influencer-terms/[id]/pdf`, `admin/paypal-diagnostics`, `admin/subscription-payments/[id]/pdf`, `analytics`, `analytics/campaign-comparison`, `brands` (GET/POST), `brands/[id]/logo`, `brands/[id]/members` (GET/POST/PATCH/DELETE), `contracts/[id]`, `dashboard`, `influencers` (GET), `influencers/[id]/pro`, `influencers/pro-attempt-followup`, `influencers/ranking`, `influencers/sync-instagram` (admin o secreto de cron), `locations` (`authorizeLocationsAdmin`).
- **Parciales, a decidir**: `payroll` (GET/POST/PATCH: admin **o `finance` de la organización**: un `finance` de marca gestiona nóminas de su organización; confirmar si es intencional) y `bookings` (GET sin comprobación de rol: cualquier miembro lista los bookings de su organización; POST/PUT/DELETE: **no** son solo admin — los autoriza `resolveCampaignWriteOrg`: cualquier miembro de la organización dueña de la campaña, sin comprobar rol ni permiso de marca, o un admin de plataforma; CORREGIDO 2026-10-22, ver §10).
- Límite: no se probaron con tests dedicados estas ~20 (salvo las ya cubiertas por `getorgid-admin-guards`); la conclusión sale de leer su comprobación.


## 10. payroll y bookings: roles por operación (auditoría 2026-10-22; sin cambios de código)

Hechos (leídos en código, probados en `tests/payroll-bookings-access.test.ts`: 4 pruebas del comportamiento actual pasan; 3 de política recomendada marcadas `todo`):

| Operación | Hoy | Quién la usa | Rol que debería poder (recomendación) |
|---|---|---|---|
| `payroll` GET/POST/PATCH | `isAdmin` (super_admin) **o** `finance` de la organización; filtra por `organization_id` | solo `/admin-payroll` (`useBilling`) | Solo admin de plataforma. Es el pago a influencers, no la facturación de la marca; `finance` de marca no debería gestionarlo. |
| `bookings` GET (agenda) | cualquier miembro autenticado de la organización, sin rol | solo `/admin-bookings` | Solo admin de plataforma (ninguna pantalla de marca lo consume). |
| `bookings` POST/PUT/DELETE | admin, **o cualquier miembro** de la organización dueña de la campaña (incluye `member` y `finance`) | `CampaignDetail`/`CampaignForm`, reutilizados en el portal de marca | Admin, o marca con `campaign.manage` sobre campaña propia en estado operativo (`authorizeCampaignBrandAction`): owner y brand_manager sí; member y finance no. |
| `bookings/send-confirmations`, `bookings/influencers/[id]` | `isPlatformAdmin` | admin | Correcto. |
| `bookings/confirm` | público con `confirmation_token` obligatorio | influencer por enlace | Correcto. |

Riesgo real hoy: un `member` (solo lectura) o `finance` de una marca puede crear/editar/borrar bookings (y eventos de calendario) de las campañas de su organización. Impacto acotado a su propia organización (no cruza tenants, probado).
Cambio propuesto (NO aplicado, requiere aprobación): GET bookings y payroll → `isPlatformAdmin`; escrituras de bookings → `authorizeCampaignBrandAction(..., 'campaign.manage')` con bypass admin. Al aprobarlo basta quitar `todo` de las 3 pruebas.

## 11. Comparaciones organización-del-admin vs organización-de-la-ficha (sin sustituir por `isPlatformAdmin`)

Datos de producción (solo lectura): 2875 de 2876 fichas viven en la organización que contiene al único super_admin; 1 ficha en una organización de marca.

| Ruta | Comparación | ¿Acceso global correcto? | Efecto de mantener / sustituir |
|---|---|---|---|
| `admin/influencer-documents` (2 puntos) | `ficha.organization_id === orgId del admin` | Sí para admin de plataforma (documentos legales de cualquier influencer) | Hoy la ficha en org de marca devuelve 404 al admin; con `isPlatformAdmin` sin comparación se vería. Falta demostrar que no deba ser así: **no cambiado**. |
| `admin/influencer-terms/[id]/pdf` | igual | Igual | **no cambiado**. |
| `GET influencers/[id]` / `canManageInfluencer` | 400 si ficha sin org; membresía | Requiere decisión del contenedor (v2) | Sin org → 400 (0 fichas hoy). |
| `isOrgAdmin` (`lib/influencers/authz.ts`) | basado en membresía | Correcto para marcas; para plataforma ya hay `isPlatformAdmin` | sin cambio. |
| Listados admin de affiliates/settlements/events/tickets | filtran por org propia del admin | Dependen de que los registros comerciales estén en la org del contenedor | Con v2 (contenedor único) son coherentes; con alternativa E habría que filtrar por `influencer_id`. |

Conclusión: ninguna comparación se reemplaza hasta aprobar el contenedor; el único caso divergente hoy es la 1 ficha en org de marca (2 `brand_influencers`).


## 12. Cambios locales de payroll/bookings y migración RLS preparada (aprobados para preparar, NO aplicados)
- Código local: `payroll` GET/POST/PATCH → `isPlatformAdmin`; `bookings` GET → `isPlatformAdmin`; `bookings` POST/PUT/DELETE → `authorizeCampaignBrandAction(..., 'campaign.manage')` (sin campaña: solo admin, en su organización); PUT ya no reasigna `campaign_id`/`organization_id`/`created_by`/`calendar_event_id`. Pruebas: `tests/payroll-bookings-access.test.ts` (11, sin `todo`).
- Migración preparada, NO aplicada: `supabase/migrations/20261022170000_restrict_influencers_rls.sql`; prueba local `scripts/test-rls-influencers-local.mjs` (113 comprobaciones).
- Hallazgo: de las 11 políticas, 10 consultan `influencers` y `brand_influencers` solo coincide por nombre. Esas 10 evalúan `i.user_id = auth.uid()` con la RLS de `influencers` del que consulta; como un influencer no es miembro de la organización de su ficha, hoy esas lecturas «propias» por PostgREST devuelven 0 filas (antes y después de la migración). Dar a la influencer lectura de su propia ficha (`user_id = auth.uid()`) sería una ampliación: requiere decisión aparte.


## 13. Administrador de plataforma que también es miembro de una marca
- Corregido en local: `authorizeCampaignBrandAction` evalúa primero `isPlatformAdmin` (membresía `super_admin` ACTIVA). Antes, una membresía de marca lo reducía a su marca.
- Pruebas (`payroll-bookings-access`, 15): conserva acceso global a bookings de otras marcas, agenda y payroll; no amplía a un ex-administrador (membresía inactiva), a brand_manager ni a owner. Sin la corrección, 2 de ellas fallan.
- PENDIENTE (no cambiado): estas rutas evalúan primero `resolveBrandAccess` y por tanto dejan a un administrador-miembro limitado a su marca: `campaigns/[id]/report`, `campaigns/[id]/influencers/export`, `campaigns/[id]/collaboration-opportunity`, `campaigns/[id]/duplicate`. Otras rutas BRAND-ONLY (`/api/brand/*`) son del portal de marca y no se tocan.

## 14. Portal de influencers y su propia ficha
Auditoría: ninguna ruta `/api/influencer/*` ni el layout leen `influencers` con la sesión del usuario; todas usan service_role filtrando por `user_id = sesión`. El cliente de navegador no consulta `influencers`. Por eso la RLS cerrada no rompe el portal. Propuesta (no aplicada): `docs/audits/PROPUESTA_influencer_self_read_2026-10-22.sql`; probada en local (8 comprobaciones). Solo la necesitarían las 10 políticas «propias» de otras tablas.
