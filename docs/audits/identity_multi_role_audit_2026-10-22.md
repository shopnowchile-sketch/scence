# SCENCE — identidad única y múltiples funciones

Estado: implementación local pendiente de revisión. Esta auditoría distingue
lo comprobado en código y migraciones de lo que requiere validación contra una
base aislada. No se ejecutó ninguna migración ni se modificaron datos reales.

## Estado actual comprobado

`auth.users.id` es la identidad de inicio de sesión. `profiles.id` comparte ese
identificador y guarda datos de presentación; `profiles.role` no es fuente de
autorización. La fuente canónica de roles y pertenencias es
`organization_members`, única por `(organization_id, user_id)`, con roles
`super_admin`, `brand_manager`, `finance`, `member` e `influencer`.

`influencers.user_id` enlaza, de forma única, una identidad con el perfil de
influencer y sus relaciones (postulaciones, reservas y campañas). Una marca
vive en una organización de tipo `brand`; `brands.organization_id` la enlaza a
esa organización. `brand_members` conserva la invitación/listado de equipo y
su `user_id` se sincroniza con `organization_members`.

El registro de influencer crea `profiles` y el perfil mediante
`handle_new_user()`. El registro de marca crea una identidad nueva y usa
`ensureBrandRow()`. Las invitaciones de marca buscan primero la cuenta por
correo, luego vinculan `brand_members` y hacen upsert de
`organization_members`. `linkPendingBrandMembership()` resuelve invitaciones
históricas pendientes al abrir el portal de marca. El enlace de confirmación
solo crea sesión; no concede permisos.

`src/middleware.ts` usaba `is_brand` e `is_influencer` de `user_metadata` como
roles mutuamente excluyentes. Una influencer invitada a una marca recibía
`is_brand` y era redirigida desde `/inf-*` hacia `/brand-dash`, aunque su
`influencers.user_id` seguía intacto. `brand_id` en metadata tampoco prueba
pertenencia a una marca.

La migración `20261004184849_brand_membership_sync_hardening.sql` sincroniza
`brand_members` hacia `organization_members`, pero su trigger mapeaba cualquier
rol distinto de `finance` a `brand_manager`. Eso promovía un `member`.

RLS permite que un usuario lea su propia fila de `organization_members`, pero
las rutas usan mayoritariamente service role: la defensa efectiva de los datos
es la autorización en cada API. Las rutas de marca auditadas usan
`resolveBrandAccess()` y `hasBrandPermission()`; las rutas administrativas usan
`isPlatformAdmin()`.

## Comportamiento objetivo implementado localmente

Una persona conserva el mismo `auth.users.id` al ser invitada a una marca. Su
fila de `influencers` no se borra ni se reinicializa. Puede tener un perfil de
influencer y una o más membresías de marca activas a la vez.

Los portales se determinan en servidor: influencer por `influencers.user_id`,
marca por `resolveBrandAccess()` y plataforma por `isPlatformAdmin()`. El
middleware deja de usar metadata para redirigir o autorizar; para navegación de
marca solo hace un filtro inicial de membresía propia y las APIs conservan la
verificación completa de marca y permiso. Un acceso a `/brand-*` sin membresía
no entrega datos: las APIs lo rechazan.

La ruta de entrada por defecto prioriza admin de plataforma, luego influencer y
luego marca. Esto conserva el flujo histórico de influencer al iniciar sesión;
una identidad dual puede abrir explícitamente ambos portales. No se creó un
selector de marca: `resolveBrandAccess()` mantiene su selección determinista
actual para una persona con varias marcas. Esa limitación debe revisarse si se
requiere cambiar de marca dentro de una misma sesión.

La migración preparada `20261022150000_preserve_brand_member_role_sync.sql`
conserva `member` durante la sincronización. No modifica registros históricos:
su corrección exige identificar filas concretas y aprobación para escribir
datos.

## Aspectos no verificados

Esta sección es del trabajo de código; la verificación de datos está en el anexo final. No se aplicaron migraciones. La eficacia de RLS y el
trigger nuevo debe validarse en una base aislada. Las rutas no auditadas aquí
deben seguir usando sus helpers canónicos; esta implementación no interpreta
metadatos como autorización.

## Anexo 2026-10-22: entornos de datos y marcas (solo lectura)

**Entornos.** `dexpvoubiklgotuukrml` es la rama de pruebas `campaign-locations-test` (comprobado; Vercel la rotula «NO produccion»). `xzzbishzfyovrladcaeb` es el único proyecto de la cuenta y es **producción probable** por evidencia indirecta (2.722 usuarios, 2.873 influencers, login del mismo día, sin datos `.invalid`, migraciones hasta `20261010184627`); no está probado directamente porque el valor de la variable en Vercel está oculto. Toda la investigación inicial de usuarios, organizaciones y las dos modificaciones de membresía de esta sesión se hicieron en la **rama de pruebas**. En producción probable solo hubo consultas de lectura.

**Hechos (producción probable).** 71 marcas (61 `approved`, 10 `pending_approval`); 97 orgs `brand` y 28 `agency`; 26 orgs `brand` y 28 `agency` sin marca; 4 con «gmail» en el nombre; ninguna organización compartida entre marcas; ninguna marca sin organización; `created_by` en 71 marcas (27 usuarios) y `invited_by_organization_id` en 0. `Scence` y `Influencers.snc`: datos en `CLAUDE.md` §16.9.

**Hipótesis (sin comprobar).** Rol interno de `Influencers.snc`; residuo en la org `SCENCE SpA` (brand, sin marca); suscripciones `incomplete` como pagos abandonados. Ninguna se usa como regla.

**Pendientes (no implementados):** relación marca→marca; bloqueo servidor por `brands.status`; `user_can_access_brand` consulta `profiles`; auditoría de rutas con service role que editan o borran marcas; carrera de `ensureOrg()`; limpieza de organizaciones huérfanas (requiere autorización); migraciones preparadas sin aplicar.
