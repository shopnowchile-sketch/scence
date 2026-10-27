# SCENCE — Auditoría del modelo de marcas: hallazgos y propuestas (2026-10-22)

Estado: **propuesta, nada de lo marcado «requiere aprobación» está aplicado.** Entorno de datos consultado en solo lectura: proyecto `xzzbishzfyovrladcaeb` (producción **probable**, ver `CLAUDE.md` §16.9). La rama `dexpvoubiklgotuukrml` es de pruebas y no se usó como evidencia de producción.

Revisión 2 (mismo día): incorpora las decisiones de la fundadora (§5), la auditoría de cómo se identifica quién registró cada marca (§3) y corrige la propuesta anterior (§4).

Regla de negocio: SCENCE es la única administradora; todas las demás entidades son marcas del mismo nivel (SCENCE SpA es una marca de pruebas); toda marca pasa por la aprobación de SCENCE; una marca puede registrar otras y consultar las que registró; aislamiento de datos y permisos; ningún privilegio por nombre.

## 1. Hechos comprobados

- `brands` solo tiene política RLS de lectura (`user_can_access_brand(id)`); toda escritura pasa por rutas con service role. `organizations` y `organization_members` solo permiten leer lo propio.
- Crear, editar y borrar marcas: `GET/PATCH/DELETE /api/brands/[id]` y `GET/POST /api/brands` comprueban admin de plataforma antes de tocar datos (cubierto por pruebas nuevas).
- Estado inicial: la columna `brands.status` tiene default `pending_approval`; el registro propio (`ensureBrandRow`), `POST /api/brand/brands`, `owned-brands` (influencer) y CRM no aceptan `status` del cliente.
- `DELETE /api/brands/[id]` hace borrado físico de la marca con cascada sobre documentos, contratos, locaciones, colaboraciones, `campaign_brands`, historial CRM y miembros de marca; **no** borra la organización técnica ni el usuario de Auth.
- En producción probable: 26 organizaciones `brand` y 28 `agency` sin marca; 4 con «gmail» en el nombre; 0 correos de marca duplicados; no existe índice único sobre `contact_email`.
- `created_by` está en las 71 marcas (27 usuarios) pero identifica un usuario; `invited_by_organization_id` e `invited_by_brand_id` están en 0 marcas: no existe linaje marca→marca registrado.
- Migraciones del repo posteriores a la última aplicada (`20261010184627`): `20261012230000`, `20261021120000`, `20261022120000`, `20261022150000`. Falta comparar fila a fila las 94 del repo con las 97 aplicadas (hay versiones aplicadas desde el panel).

## 2. Riesgos confirmados

| # | Riesgo | Evidencia | Estado |
|---|---|---|---|
| R1 | `ilike` con correo sin escapar: `_`, `%`, `*` actuaban como comodines. Una marca podía descubrir el nombre de otra por la respuesta 409 de `POST /api/brand/brands`, y `ensureBrandRow` podía vincular una marca existente sin dueño a un correo distinto. | Lectura de código; prueba de emulación en `tests/brand-registration-hardening.test.ts`. En producción probable ninguna marca tiene `_`/`%` en el correo (no hay evidencia de explotación). | **Corregido en local** (sin commit). |
| R2 | `POST /api/brand/brands` exige *alguna* membresía (`getOrgId`) y toma como «org del registrante» la primera por antigüedad, que puede ser la de influencer o la de plataforma. **Corrección de criterio:** registrar marcas no debe limitarse a usuarios de marca ni a admins; el problema no es quién entra sino que el vínculo con el registrante no es fiable y que no hay regla de estado ni antiduplicados. | `src/app/api/brand/brands/route.ts` | Requiere aprobación (ver §4). |
| R3 | El servidor no bloquea por `brands.status`: `resolveBrandAccess` no lo lee, y `user_can_access_brand` (RLS) tampoco. Rechazada o suspendida conserva acceso a datos. | `ensureOrg.ts`, definición de la función | Requiere decisión + aprobación. |
| R4 | `user_can_access_brand` consulta `profiles.role = 'super_admin'`, contra `CLAUDE.md` §16.2. Además conserva cláusulas heredadas (`brands.user_id`, `brand_members`). | Definición en producción probable | Requiere migración. |
| R5 | Marcas colaboradoras sin correo se creaban `approved` sin pasar por SCENCE. En producción probable hay 14 así. | `campaigns/[id]/brands/route.ts`; consulta de solo lectura | **Ruta corregida en local** (nacen `pending_approval`). Las 14 existentes no se tocan: revisión por separado (§4, P8). |
| R6 | Carrera y huérfanas: 5 rutas crean la organización y luego la marca; si falla la inserción (o dos solicitudes compiten) queda una organización sin marca. No hay índice único de correo ni de nombre. | `provisionOrgForBrand` + inserciones | Requiere aprobación (borrado/función SQL). |
| R7 | `DELETE` físico irreversible de marcas con cascada amplia, solo protegido por admin de plataforma. | FK `ON DELETE CASCADE` | Decisión tomada: archivar por defecto; requiere aprobación (P7). |
| R8 | `ensureBrandRow` vincula una marca sin dueño por correo **no verificado** (`email_confirm: false`). En local `enable_confirmations = false`; el valor en producción no se verificó. | `register-brand`, `supabase/config.toml` | Hipótesis a verificar; requiere aprobación (autenticación). |
| R9 | Políticas de `brand_members` (`INSERT`/`UPDATE`) con rol `public` para el dueño legado (`brands.user_id`) permiten escribir desde el cliente, salteando `hasBrandPermission`. Alcance limitado a su propia marca. | `pg_policies` | Riesgo bajo; revisar al reescribir RLS. |

## 2b. Cambios implementados localmente (sin commit)

- `src/lib/email-match.ts` (nuevo): `exactEmailPattern` y `isPlausibleEmail`.
- `src/lib/supabase/ensureOrg.ts`: `ensureBrandRow` busca la marca sin dueño con coincidencia exacta; si el correo es ambiguo, no vincula y crea una marca nueva en `pending_approval`.
- `src/app/api/brand/brands/route.ts`: valida formato del correo y usa el patrón exacto.
- `src/app/api/campaigns/[id]/brands/route.ts`: mismo patrón exacto en la búsqueda por correo.
- `src/app/api/influencer/owned-brands/route.ts`: la detección de duplicados por nombre usa comparación exacta (antes un nombre con `%` o `_` podía revelar a una influencer el nombre de otra marca).
- `src/app/api/campaigns/[id]/brands/route.ts`: toda marca colaboradora nueva nace `pending_approval`, con o sin correo (decisión 3). No hay dependencia aguas abajo del estado `approved` para colaboradoras (solo las invitaciones de acceso exigen `approved`, y eso es lo esperado). No modifica las 14 existentes.
- `tests/brand-registration-hardening.test.ts` (nuevo, 9 pruebas): comodines, guardas de admin antes de acceder a datos, `status` no aceptado desde el cliente, ninguna inserción `approved`, colaboradora sin correo `pending_approval`, nombres sin comodines.

No cambia datos, RLS, roles, membresías ni autenticación; el comportamiento solo cambia para correos con `_`, `%`, `*` o `\`.

## 3. Auditoría: cómo se identifica hoy quién registró cada marca

**Conclusión:** `created_by` significa «usuario de Auth que ejecutó la creación», no «marca registradora» ni «persona registradora» de forma uniforme. No se debe usar como relación marca→marca.

| Flujo | Quién ejecuta | Qué queda escrito | ¿Identifica al registrante? |
|---|---|---|---|
| Autorregistro (`register-brand` → `ensureBrandRow`) | La futura dueña | `created_by = user_id =` la propia usuaria; membresía `brand_manager` propietaria de su marca | No hay «otro» registrante: es la marca misma. |
| Marca registra marca (`POST /api/brand/brands`) | Usuario con alguna membresía | `created_by =` ese usuario; `metadata.invited_by_organization_id =` primera membresía por antigüedad (puede no ser una org de marca); no crea membresía para el registrante | Parcial y poco fiable; **0 marcas en producción probable** lo tienen. |
| Influencer registra marca (`influencer/owned-brands`) | Influencer | `created_by =` la usuaria, `referred_by_influencer_id`, `metadata.source='influencer_referral'`, `referrer_user_id`; no crea membresía | Sí, por `referred_by_influencer_id` (1 marca). Se consulta con `GET /api/influencer/owned-brands`. |
| Colaboradora desde campaña (`campaigns/[id]/brands`) | Admin o usuario de la marca de la campaña | `created_by =` quien la añadió; `invited_by_brand_id = campaign.brand_id` (la marca *de la campaña*, no necesariamente la registradora, y puede ser nula); sin membresía | No fiable; **0 filas** con `invited_by_brand_id`. |
| Conversión de lead CRM / alta administrativa | Admin | `created_by =` admin | Registrante = plataforma. |
| Importaciones históricas | Admin | `created_by =` admin | Registrante = plataforma. |

Datos (producción probable, 71 marcas): 24 autorregistros (`created_by = user_id`); 27 con `created_by` de un admin de plataforma; 1 de influencer (`influencer_referral`); 18 con `source = campaign_collaborator` (14 sin usuario); 12 con `created_by` distinto de su usuario. Ninguna tiene `invited_by_organization_id` ni `invited_by_brand_id`. Ninguna marca tiene como registrante a una influencer salvo la de referido.

Otros hallazgos de este flujo:
- `GET /api/brand/brands` filtra por `created_by = user.id`: en un autorregistro devolvería la propia marca como «Creada por ti». Con la regla nueva (la persona que registra consulta lo que registró) hay que distinguir autorregistro de registro de terceros.
- Ningún flujo concede `brand_manager` al registrante de **otra** marca (cumple la regla). El autorregistro sí crea la membresía de dueño de su propia marca (lo esperado; se pide confirmación en la pregunta 6).
- El vínculo debe ser **persona→marca** (usuario de Auth, que puede ser influencer, admin o dueña de otra marca) y, opcionalmente, la marca desde la que actuaba. No hay base para convertir `created_by` en marca→marca.

## 4. Propuestas que **requieren aprobación** (SQL no aplicado; corrige la propuesta anterior)

Cada una debe probarse primero en una rama de Supabase nueva (no en la de pruebas existente ni en producción) y aplicarse con ventana y respaldo.

**P1. Unicidad de correo de marca (R6).**
```sql
-- Previo: select lower(contact_email), count(*) from brands where contact_email is not null group by 1 having count(*)>1;  -- hoy 0
create unique index concurrently if not exists brands_contact_email_lower_unique
  on public.brands (lower(contact_email)) where contact_email is not null;
-- Reversión: drop index concurrently if exists public.brands_contact_email_lower_unique;
```
Riesgo: rutas que hoy insertan duplicados pasarán a fallar con 23505; hay que manejarlo en código.

**P2. RLS sin `profiles` (R4).** Sustituir la cláusula `profiles.role='super_admin'` por una comprobación de `organization_members` (`role='super_admin'`, `is_active`). Reversión: restaurar la definición actual (guardada arriba en §1 de esta auditoría y en la base). Mantener las cláusulas heredadas en una primera etapa y quitarlas después de medir. Pruebas: marca A no lee marca B; `super_admin` lee todas; usuario sin membresía no lee ninguna.

**P3. Estado de la marca aplicado por el servidor (R3, decisión 1).** `resolveBrandAccess` pasa a devolver `status` y se añade una única función de capacidades; las rutas de marca la usan, no la interfaz.

| Estado | Perfil y estado de aprobación | Pasos de aprobación | Operación (campañas, CRM, influencers, equipo, documentos) | Facturación |
|---|---|---|---|---|
| `pending_approval` | sí | sí | no | no |
| `approved` | sí | n/a | según rol y plan | según rol |
| `rejected` | solo resultado y datos para pedir revisión | solo solicitar revisión | no | no |
| `suspended` | sí (lectura) | solo lo expresamente autorizado para resolver la suspensión | no | solo obligaciones pendientes, si se autoriza |

Plan: (1) clasificar las 19 rutas bajo `api/brand/*` y las que usan `resolveBrandAccess` (37 archivos) en {perfil, aprobación, operación, facturación}; (2) pruebas por estado (4 estados × 4 clases, más `super_admin` sin restricción); (3) implementar y activar tras revisión. Riesgo: bloquear a marcas hoy operativas con estado inconsistente; antes de activar, listar marcas con usuario y estado ≠ `approved` (hoy 10 `pending_approval`). `api/brand/campaigns` ya exige `approved` en un punto. Reversión: interruptor de código (variable de entorno) o revertir el commit. Alcance RLS: el mismo criterio se aplica después en `user_can_access_brand` (P2).

**P4. Registro atómico, idempotente y sin huérfanas (R6).** Una función SQL `register_brand(...)` (`security definer`, ejecutable solo con service role) que, en **una transacción**, valida duplicados (correo, Instagram normalizado), crea organización y marca `pending_approval`, y registra al registrante; si algo falla no queda nada. Reintentos: clave de idempotencia = (`registered_by_user_id`, correo en minúsculas) o Instagram normalizado, con los índices únicos de P1; una solicitud repetida devuelve la marca existente en vez de crear otra. Las cinco rutas (`register-brand`/`ensureBrandRow`, `brand/brands`, `owned-brands`, `campaigns/[id]/brands`, CRM, `brands` admin) llaman a la función. Alternativa menor sin función: borrar la organización recién creada si falla la inserción (no cubre carreras). Reversión: dejar de llamar a la función y borrarla; sin cambios de datos.

**P5. Limpieza de organizaciones sin marca.** Primero listado de solo lectura:
```sql
select o.id, o.name, o.type, o.created_at,
  (select count(*) from organization_members m where m.organization_id=o.id) as miembros,
  (select count(*) from campaigns c where c.organization_id=o.id) as campanas,
  (select count(*) from subscriptions s where s.organization_id=o.id) as suscripciones
from organizations o
where not exists (select 1 from brands b where b.organization_id=o.id);
```
No borrar nada con miembros, campañas o suscripciones (p. ej. `Scence SpA`, la organización que contiene al `super_admin`). Mover primero al `super_admin` si hace falta. El borrado lo ejecuta la fundadora tras revisar el listado.

**P6. Registro: quién registró cada marca (persona, no marca).** Columnas nuevas en `brands`: `registered_by_user_id uuid references auth.users(id) on delete set null`, `registered_by_brand_id uuid references brands(id) on delete set null` (marca desde la que actuaba, opcional) y `registration_source text`. Se rellenan en `register_brand`. **Relleno histórico solo con evidencia inequívoca:** `influencer_referral` (`registered_by_user_id = created_by`), autorregistros (`created_by = user_id`, `registration_source='self'`) y altas de admin (`registration_source='platform'`). Las demás (`campaign_collaborator`, 12 con `created_by` distinto) quedan nulas hasta revisarse. Consulta: «mis marcas registradas» por `registered_by_user_id = auth.uid()` (o por pertenencia a la marca registradora si se pide), devolviendo lista, estado de aprobación y datos básicos; campañas, facturas, contactos privados e información interna requieren un permiso explícito (tabla `brand_data_shares`, a diseñar con su propia aprobación). Registrar no concede `brand_manager` ni acceso a otras marcas. Reversión: eliminar columnas; no altera datos existentes.

**P7. Archivar en vez de borrar (R7, decisión 4).** Estado `archived` (o `archived_at`), acceso bloqueado como `rejected`, visible para SCENCE. `DELETE` físico queda solo para un proceso excepcional: ruta separada, `super_admin`, confirmación escrita y listado previo de dependencias (conteo por tabla con cascada). Requiere migración de restricción de estados y cambio en `PATCH`/`DELETE`.

**P8. Colaboradoras existentes `approved` sin usuario ni correo (14).** No cambiar su estado automáticamente. Entregar listado de solo lectura (id, nombre, campañas) y decidir una por una: verificadas por SCENCE → se mantienen; el resto → `pending_approval`. Cualquier actualización requiere aprobación.

## 5. Decisiones de la fundadora (2026-10-22)

1. **Estados:** el servidor aplica las restricciones (tabla de P3).
2. **Marcas registradas:** el registrante ve lista, estado de aprobación y datos básicos; nada más sin permiso explícito.
3. **Colaboradoras sin correo:** nacen `pending_approval`; las preexistentes verificadas se revisan por separado.
4. **Borrado:** archivar o desactivar por defecto; borrado definitivo solo excepcional, autorizado y con revisión de dependencias.
5. **Quién registra:** los usuarios autorizados, incluidas las influencers, pueden registrar marcas. Toda marca nueva pasa por la aprobación de SCENCE. Registrar no concede `brand_manager` ni permisos sobre otras marcas. Debe haber antiduplicados y cero organizaciones huérfanas ante reintentos y solicitudes simultáneas.

6. **Autorregistro:** la persona queda como responsable de su propia marca (`brand_manager` de esa marca únicamente), sin permisos globales ni acceso a otras marcas.
7. **Quién registra:** influencers y usuarios de marcas con cuenta verificada y activa, más administradores autorizados de SCENCE. Nunca una cuenta sin verificar.
8. **Marca que registra:** solo puede hacerlo cuando está `approved`. Las influencers registran desde su propia cuenta, sujetas a la verificación de SCENCE.

*(Reglas 6–8 confirmadas el 2026-10-22.)*

## 5b. Estado de implementación local de P3 y P4 (2026-10-22, sin commit ni despliegue)

- **P3 (estados en servidor):** `src/lib/brand-status-access.ts` define la matriz; `hasBrandPermission` la aplica de forma central (falla cerrado ante estado ausente o desconocido); además `campaigns` (GET/[id]), `invoice-authorize` (capacidad `billing`) y el onboarding de marca.
- **P4 (creación atómica e idempotente):** función SQL `public.register_brand` (migración `20261022160000_register_brand_atomic.sql`, solo `service_role`) con bloqueos consultivos, clave de idempotencia única, reintento de slug y reversión completa ante error. Todos los puntos de alta la usan: `brands`, `brand/brands`, `influencer/owned-brands`, `campaigns/[id]/brands` (2), `crm-leads/[id]` y `ensureBrandRow` (autorregistro). `ensureOrg` se eliminó; ninguna ruta crea marcas u organizaciones por fuera de la función (test estático).
- **Base de datos:** la migración se aplicó **solo** a la rama de pruebas `dexpvoubiklgotuukrml` (verificada distinta de producción `xzzbishzfyovrladcaeb`). **No se aplicó a producción.** El camino de respaldo no atómico **se eliminó**: sin la función, el registro falla cerrado. Orden: migración primero, código después. Ver `register_brand_deploy_plan_2026-10-22.md`.
- **Pendientes por decidir:** (a) si `brand.manage` es el permiso que habilita registrar marcas; (b) *decidido 2026-10-22:* la marca `pending_approval` completa su registro y **consulta** facturación (sin emitir/pagar), sin campañas operativas; (c) la prueba de concurrencia real queda como script (`scripts/test-register-brand-concurrency.mjs`), no ejecutado.

## 5c. Hallazgo adicional

`settings/organization` usa `select('*')` sobre `organizations`; revisar que no exponga columnas con tokens de Google a roles sin permiso. No se modificó.

## 6. Validación pendiente

`next build` no se ejecutó en esta sesión. Pruebas de comportamiento de `register_brand` ejecutadas en la rama de pruebas (reintentos, reversión, estados); la concurrencia real sigue sin demostrarse (la herramienta serializó las llamadas): usar el script indicado en 5b. No se verificó el ajuste de confirmación de correo de Auth en producción. No se probó contra una base aislada ninguna de las propuestas SQL.
