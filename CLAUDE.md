# 🚨 REGLA CERO — NO CAMBIAR COMPORTAMIENTO DE NEGOCIO SIN AUDITAR

Si un cambio puede afectar:

- quién ve una campaña;
- quién puede postular;
- quién puede aprobar;
- quién puede ver un brief;
- quién puede ver información de una marca;
- quién puede ver información de una influencer;
- pagos;
- ownership;
- permisos;

**NO IMPLEMENTAR DIRECTAMENTE.**

Primero AUDITAR y explicar la causa raíz.

Nunca asumir.

Nunca inventar.

Nunca crear una solución paralela si ya existe lógica reutilizable.

Una modificación aparentemente pequeña puede afectar todo el negocio.

---

# SCENCE — PRINCIPIOS DE PRODUCTO, NEGOCIO Y EJECUCIÓN

Estos principios son permanentes para cualquier trabajo realizado sobre SCENCE.

## 1. Objetivo principal de SCENCE

SCENCE no existe para crear software por crear software.

El objetivo principal es construir una empresa rentable y escalable que facilite la gestión de campañas de influencer marketing y que las marcas quieran seguir utilizando.

Prioridades:

1. Ventas
2. Retención de clientes
3. Valor para las marcas
4. Experiencia simple
5. Escalabilidad
6. Automatización
7. Tecnología

La tecnología está al servicio del negocio.

Cuando haya varias soluciones técnicamente válidas, preferir la que:
- sea más simple;
- genere más valor para el cliente;
- facilite la venta;
- aumente la retención;
- reduzca trabajo manual;
- pueda escalar.

## 2. SCENCE debe venderse fácil

Cada nueva funcionalidad debe evaluarse preguntando:

"¿Esto hace que SCENCE sea más fácil de vender?"

y:

"¿Esto hace que una marca tenga más razones para seguir pagando?"

No construir funcionalidades solamente porque sean técnicamente interesantes.

Priorizar funcionalidades que permitan:

- conseguir clientes;
- activar clientes rápidamente;
- lograr que una marca ejecute su primera campaña;
- conseguir que una marca vuelva a crear otra campaña;
- aumentar campañas por cliente;
- aumentar influencers activos;
- reducir trabajo operativo;
- demostrar resultados.

## 3. SCENCE no debe depender de perseguir clientes

El producto debe hacer visible qué necesita hacer el cliente.

Ejemplos:

Si una marca tiene postulaciones pendientes → SCENCE debe hacerlo evidente.

Si una campaña necesita aprobación → SCENCE debe indicarlo.

Si faltan entregables → SCENCE debe mostrarlo.

Si una campaña está detenida → SCENCE debe señalarlo.

El objetivo es reducir situaciones donde la fundadora tenga que escribir manualmente:

"¿Pudiste entrar?"
"¿Pudiste revisar?"
"¿Pudiste aprobar?"
"¿Pudiste crear la campaña?"

SCENCE debe reemplazar ese seguimiento manual por producto.

## 4. No entregar gratuitamente el valor estructural de SCENCE

Las marcas pueden trabajar con influencers, pero SCENCE debe conservar el valor de la infraestructura que permite gestionar esa relación.

SCENCE debe ser el sistema donde ocurre:

- descubrimiento;
- selección;
- postulación;
- aprobación;
- brief;
- contratos;
- entregables;
- seguimiento;
- pagos;
- métricas;
- reporting;
- historial.

No diseñar flujos que conviertan a SCENCE en un intermediario fácilmente reemplazable.

El objetivo no es "poseer" influencers.

El objetivo es que tanto marcas como influencers encuentren valor en permanecer dentro de SCENCE.

## 5. Network effect

Cada influencer activa aumenta el valor potencial de SCENCE.

Cada marca activa aumenta las oportunidades para las influencers.

Cada campaña ejecutada genera datos y aprendizaje.

Cada interacción debe fortalecer la plataforma.

Pensar siempre: "¿Cómo hace esto que SCENCE sea más valioso a medida que crece?"

## 6. Experiencia Apple / extrema simplicidad

SCENCE debe sentirse simple.

Antes de agregar una nueva pantalla, componente, configuración, estado o flujo, preguntar:

- ¿Ya existe algo que haga esto?
- ¿Podemos reutilizarlo?
- ¿Podemos simplificarlo?
- ¿Podemos resolverlo modificando la lógica existente?

Regla: **REUTILIZAR > MODIFICAR > CREAR**

No crear arquitectura nueva si la existente puede resolver el problema.

## 7. Proteger el negocio

La información debe estar correctamente separada entre ADMIN, MARCA e INFLUENCER.

Nunca asumir que porque algo está oculto en frontend está protegido.

Toda información sensible debe estar protegida también en backend/API.

Especialmente:

- briefs;
- datos privados de campañas;
- información de marcas;
- información de influencers;
- contratos;
- pagos;
- datos internos.

## 8. Regla de visibilidad de campañas

Las campañas no son globales.

**Marca:** una marca solamente puede ver sus propias campañas.

**Influencer:** una influencer puede ver campañas de marcas que estén publicadas/disponibles según las reglas existentes. Una influencer NO debe ver campañas personales de otras influencers. Una influencer NO debe acceder a briefs privados mientras su postulación esté pendiente.

Pending:
- información general de campaña
- descripción pública
- estado de postulación

NO:
- brief privado
- PDF
- contenido privado

Approved:
- acceso al brief completo
- descarga del PDF

**Admin:** acceso según permisos administrativos existentes.

Nunca crear una arquitectura nueva para resolver esta regla si ya existen ownership, visibility, status y relaciones que permitan hacerlo.

## 9. Aprender de los clientes

Cada problema real de un cliente debe convertirse en aprendizaje de producto.

No reaccionar solamente con un parche.

Preguntar:

- ¿Qué ocurrió?
- ¿Por qué ocurrió?
- ¿Podría ocurrir con otro cliente?
- ¿Podemos evitarlo desde producto?
- ¿Podemos automatizarlo?
- ¿Esto afecta ventas o retención?
- ¿Esto puede convertirse en una ventaja competitiva?

## 10. No perseguir perfección técnica antes de validar negocio

Cuando exista una decisión entre:

A) construir una solución técnicamente sofisticada
B) hacer un cambio pequeño que permita vender, validar o aprender

preferir B cuando sea suficiente.

SCENCE debe avanzar rápido.

**MASSIVE ACTION > PERFECCIONISMO.**

Pero massive action NO significa hacer cambios irresponsables. Significa:

AUDITAR → DECIDIR → IMPLEMENTAR → VALIDAR → MEDIR → REPETIR.

## 11. Regla anti-regresiones

Antes de modificar una funcionalidad existente:

1. Auditar cómo funciona actualmente.
2. Identificar quién puede acceder.
3. Identificar ownership.
4. Identificar estados.
5. Identificar APIs existentes.
6. Identificar dependencias.
7. Buscar casos existentes que puedan romperse.

Después de modificar:

1. Validar tipos.
2. Validar el flujo principal.
3. Validar permisos.
4. Validar los casos de otros roles.
5. Revisar el diff.
6. Confirmar que solamente se modificó lo necesario.

Nunca utilizar `git add -A` sin autorización explícita.

Nunca hacer commit, push, deploy ni migration sin autorización explícita.

## 12. Cuando haya un bug

NO comenzar creando código.

Primero responder:

- ¿Cuál es la causa raíz?
- ¿Existe ya una solución parcialmente implementada?
- ¿Qué archivo controla realmente este comportamiento?
- ¿Es frontend, backend, DB o permisos?
- ¿Puede solucionarse con un cambio mínimo?

Después proponer: archivos a modificar, causa raíz, cambio mínimo, riesgo, validación.

## 13. Prioridad comercial

Cuando la fundadora pregunte "¿Qué hacemos ahora?", priorizar:

1. Algo que pueda generar ventas.
2. Algo que permita cerrar un cliente.
3. Algo que active un cliente existente.
4. Algo que aumente retención.
5. Algo que elimine trabajo manual.
6. Algo que mejore el producto.
7. Mejoras técnicas internas.

No perder semanas construyendo funcionalidades que no tienen impacto comercial claro.

## 14. Mentalidad de SCENCE

Pensar siempre desde: abundancia, claridad, velocidad, simplicidad, valor, ventas, escala, resultados.

Los problemas no son señales de fracaso. Son información para mejorar el producto.

Cada bug puede revelar una oportunidad.

Cada cliente puede revelar una necesidad.

Cada campaña puede generar aprendizaje.

Cada influencer puede aumentar el valor de la red.

Cada marca satisfecha puede convertirse en recurrencia.

## 15. Frase central

SCENCE debe convertirse en: "El sistema que las marcas necesitan para gestionar influencer marketing de principio a fin."

El objetivo final no es que SCENCE tenga muchas funcionalidades.

El objetivo es que una marca piense: "¿Cómo hacía esto antes sin SCENCE?"

## 16. Invariantes verificados (auditoría 2026-09-05/06)

Verificados contra el schema real de Supabase y datos de producción. No re-derivarlos ni contradecirlos sin auditar de nuevo.

### 16.1 Estado de participación en campaña

`campaign_influencers.application_status` (`pending` | `accepted` | `rejected`) es la **única fuente de verdad**.

**NUNCA escribir `campaign_influencers.status`.** Esa columna está tipada con el enum `campaign_status` (`draft | pending_approval | active | paused | completed | canceled`) — no acepta `inactive`. Escribirlo hacía fallar el UPDATE en silencio y dejaba postulaciones "pendientes" para siempre en campañas ya cerradas.

Toda escritura con el admin client debe revisar `error` antes de continuar con el siguiente paso. Un UPDATE que falla y no se revisa deja la operación a medias.

### 16.2 Autorización — una sola fuente

Autorizar SIEMPRE con `organization_members`, vía `getUserRole()` (plataforma) o `resolveBrandAccess()` / `hasBrandPermission()` (marca).

- **NUNCA usar `profiles.role` para autorizar.** No es fuente de autorización: solo dato de presentación, y `ensureOrg` lo sobrescribe. Llegó a haber 3 `super_admin` en `profiles` y 1 en `organization_members`.
- **Nunca definir un `isAdmin()` local** en una ruta. Si falta el helper, importarlo.
- Para campañas, el helper central es `authorizeCampaignBrandAction()`.
- RLS está habilitado en todas las tablas, pero 148 de 154 rutas usan la service role key y lo omiten: **la protección real es el chequeo de cada ruta**. No hay segunda línea de defensa.

### 16.3 Campañas privadas y Plan Pro

`visibility = 'private'` **no** significa oculta. Significa "requiere Plan Pro para postular". Reglas:

- Toda influencer VE las campañas privadas activas del marketplace (Términos Plan Pro, secc. 6).
- Gratis: CTA "POSTULAR CON PRO" → `/inf-profile?tab=plan&return_campaign_id=<id>` → checkout PayPal existente. Pro: CTA "Postular".
- Una **invitación rechazada** no bloquea ver ni postular a esa campaña. Una **postulación rechazada por la marca** sí se sigue ocultando.
- `(campaign_id, influencer_id)` es UNIQUE: para re-postular sobre una invitación rechazada se **reutiliza la fila con UPDATE**, no se inserta.
- Se excluyen del marketplace las campañas cuyo `created_by` corresponde a un `influencers.user_id` (campañas personales).

### 16.4 Términos del Plan Pro son versionados

`INFLUENCER_PRO_TERMS.version` se compara exacta contra `influencer_terms_acceptances.document_version` en `/apply` y en `/paypal/checkout`.

**Al subir la versión, toda influencer con Pro activo queda bloqueada para postular a privadas** hasta aceptar la nueva. Usar `acceptCurrentInfluencerProTerms()` (llama al endpoint existente `POST /api/influencer/terms`) y reintentar; no duplicar esa lógica.

### 16.5 Pagos

PayPal es la única pasarela con datos reales. Stripe, MercadoPago y Oneclick no tienen ni una fila. **No crear checkouts nuevos**: el flujo Pro es `upgradeToPro()` → `/api/influencer/paypal/checkout` → `/api/influencer/paypal/complete`.

Pro se deriva de `subscriptions` (`active`/`trialing`) + `influencers.metadata.manual_pro.active`, siempre vía `getInfluencerProStatuses()` / `isInfluencerPro()`.

### 16.6 Creación de campaña

Al agregar o tocar un campo en `POST /api/campaigns` o `POST /api/brand/campaigns`, **confirmar que entra al objeto del insert**, no solo al destructuring del body: `social_tags` se extraía y se descartaba en ambas rutas, y las etiquetas que escribía la marca se perdían sin error.

La dirección de campaña vive en `metadata.address` y el lugar real del evento en `bookings`.

### 16.8 Aviso de campaña disponible

Una campaña se anuncia al roster cuando está **activa** y su `visibility` es `open` **o** `private`. `private` no es "oculta" (ver 16.3), así que también se anuncia; solo cambia el copy y el CTA, que lleva al flujo Pro → PayPal ya existente.

- La fuente única de "a quién le falta el aviso" es `resolvePendingCampaignAnnouncement()`. Los tres puntos de entrada (activación, botón manual y contador del detalle) deben usarla: no duplicar el criterio.
- La idempotencia la da `campaign_influencer_notifications`. Reactivar una campaña no reenvía correos.
- Se respeta el opt-out `profiles.metadata.notification_preferences.public_campaigns_email`.
- El envío recorre ~2.400 influencers en lotes de 100 (`resend.batch.send`): toda ruta que lo dispare necesita `maxDuration = 300`, o Vercel corta el envío a medias.
- Resend no lanza excepción ante errores de API: hay que revisar `error` en cada envío.

### 16.7 Verificación mínima antes de commit

`npx tsc --noEmit`, `npx next lint` y `next build`. En un sandbox sin salida a `fonts.googleapis.com`, el build se valida con la fuente simulada (`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`); el build real lo confirma Vercel al desplegar. La validación final del protocolo (sección 18, paso 9) añade `npm test`.

### 16.9 Modelo de marcas y organizaciones (una marca = una organización técnica)

**Modelo de negocio oficial** (decisión de la fundadora, 2026-10-22; reemplaza la redacción anterior de esta sección).

- **SCENCE** es la plataforma administradora. Es la única que puede ver, crear, editar, aprobar, suspender y borrar marcas, y lo hace mediante permisos administrativos (`super_admin` vía `organization_members`), nunca por el nombre de una marca. SCENCE (plataforma) **no** es lo mismo que SCENCE SpA.
- **Todo lo demás son marcas.** **SCENCE SpA es simplemente una marca de pruebas**: no es la plataforma, no es superior a las demás y **ninguna marca tiene privilegios especiales por su nombre**.
- **Cada marca tiene su propio perfil** y puede consultar las marcas que ella misma registró, según los permisos correspondientes (Marca A registra X e Y; Marca B registra Z). Las marcas registradas pertenecen igualmente al conjunto global administrado por SCENCE. «A registró a X» solo indica quién la registró: no hace a A plataforma ni crea otra categoría de marca.
- **Registro, confirmación de correo y aprobación son etapas distintas.** Toda marca pasa por la aprobación de SCENCE (`pending_approval` → `approved` | `rejected` | `suspended`). La aprobación cambia el estado de la marca; **no crea ni cambia una organización** (comprobado en `PATCH /api/brands/[id]`, solo `super_admin`).
- **Quién registra:** los usuarios autorizados, **incluidas las influencers**, pueden registrar marcas. Registrar **no** concede `brand_manager` ni permisos sobre otras marcas. La persona que registra consulta lista, estado de aprobación y datos básicos de las marcas que registró; campañas, facturas, contactos privados e información interna solo con permiso explícito.
- **Qué puede hacer una marca según su estado (el servidor lo aplica, no solo la interfaz):** `pending_approval`: completar perfil, ver estado y hacer los pasos de aprobación, sin funciones operativas; `approved`: lo que permitan su rol y plan; `rejected`: ver el resultado y pedir revisión, sin funciones operativas; `suspended`: operaciones bloqueadas, solo lo expresamente autorizado para resolver la suspensión u obligaciones pendientes. *(Regla de negocio; **no implementada** en el servidor, ver pendiente 3.)*
- **Borrado:** archivar o desactivar por defecto; el borrado definitivo es excepcional, autorizado y con revisión de dependencias. *(Hoy `DELETE /api/brands/[id]` es físico; pendiente 8.)*
- **Toda marca nueva nace `pending_approval`**, también las colaboradoras de campaña: ser colaboradora no equivale a estar aprobada.
- **Aislamiento:** las marcas no se ven entre sí; datos y permisos se separan por marca.

**Cómo lo representa hoy el sistema** (comprobado en código y esquema el 2026-10-22). La organización técnica es un detalle de implementación, no un concepto de negocio.

- Toda marca vive en su propia organización técnica `type='brand'` (crear con `provisionOrgForBrand()`), y su usuario tiene `organization_members` en esa org con `brand_id`. Hoy eso aísla a las marcas en RLS y rutas.
- La organización técnica `Scence SpA` (`d23d88ee-…`, `type='agency'`) concentra la operación de plataforma (admin de plataforma, roster de influencers y campañas que opera SCENCE). Tiene 0 marcas. Su nombre **no** debe leerse como «la marca SCENCE SpA».
- Las campañas pueden seguir en la org de la agencia; la marca accede por `brand_id` (`resolveBrandAccess` / `authorizeCampaignBrandAction`), nunca por `organization_id`.
- **Quién registró una marca (auditado 2026-10-22):** `created_by` es el usuario de Auth que ejecutó la creación; **no** es una relación marca→marca ni identifica de forma uniforme al registrante (en un autorregistro es la propia dueña; en altas administrativas, un admin; en colaboradoras, quien las añadió). `POST /api/brand/brands` guarda además `metadata.invited_by_organization_id` (primera membresía por antigüedad, no necesariamente de marca) y `campaigns/[id]/brands` guarda `metadata.invited_by_brand_id` (la marca *de la campaña*); ninguna marca de producción probable tiene esos campos. Solo el flujo de influencer deja un vínculo fiable (`referred_by_influencer_id`). No existe clave marca→marca ni persona→marca uniforme. Detalle por flujo: `docs/audits/brand_model_hardening_proposal_2026-10-22.md` §3.
- **Registro de marca:** `POST /api/auth/register-brand` crea el usuario y, vía `ensureBrandRow()`, la marca en `pending_approval` con su propia organización técnica. `POST /api/brand/register` no crea nada: confirma el acceso o vincula una invitación pendiente.
- Migración 2026-09-23: 15 marcas separadas (mapeo en `ops.tenant_split_20260923`; 13 recibieron `subscription_plan_override='pro'` para preservar el plan que heredaban de suscripciones de influencers — decisión comercial pendiente).

**Cifras: fuente y entorno (no mezclar).**

| Fuente | Entorno | Estado de verificación | Cifras (2026-10-22, solo lectura) |
|---|---|---|---|
| Proyecto Supabase `xzzbishzfyovrladcaeb` (rama `main`) | Producción **probable** | Indirecta: único proyecto de la cuenta; 2.722 usuarios y 2.873 influencers; login el mismo día; sin datos `.invalid`. Falta confirmar que el `NEXT_PUBLIC_SUPABASE_URL` de producción en Vercel (valor oculto) apunta a este proyecto. | 71 marcas (61 `approved`, 10 `pending_approval`); 97 organizaciones `brand` y 28 `agency`; 19 campañas; 26 orgs `brand` y 28 orgs `agency` sin marca; 4 orgs con «gmail» en el nombre; las 71 marcas con `created_by` (27 usuarios distintos; 45 del usuario administrador) y 0 con `metadata.invited_by_organization_id`; 41 con `user_id` y 30 sin él. |
| Rama `dexpvoubiklgotuukrml` (`campaign-locations-test`) | **Prueba, no producción** | Comprobada (rama de `xzzbishzfyovrladcaeb`; Vercel la rotula «NO produccion»). | 73 marcas (63 `approved`, 10 `pending_approval`); 2 con `created_by`. **No usar como cifra de producción.** |

**Hechos comprobados sobre `Scence` e `Influencers.snc`** (producción probable; lectura):

- `Scence` (`04eab544-…`, `approved`, creada 2026-07-26): usuario `hola@scence.cl`, sitio `scence.cl`, organización `Scence` con 2 miembros, 8 campañas vinculadas.
- `Influencers.snc` (`fb04fffe-…`, `approved`, creada 2026-06-23): sin usuario ni contacto, organización `Influencers SCence` con 0 miembros, 7 campañas vinculadas y 1 factura borrador de 0 CLP.
- 5 campañas incluyen a ambas marcas. Ninguna tiene `invited_by_organization_id`.
- Existe una organización `SCENCE SpA` (`4dfdb20c-…`, `type='brand'`, creada 2026-06-26) con 0 marcas y 0 campañas; su slug alude a un id de marca (`3bf3ab62…`) que no existe en esa base.
- Las suscripciones (muchas `incomplete`) cuelgan de la organización `Scence SpA` (agency), no de estas marcas.

**Hipótesis (no comprobadas; no usar como regla).** `Influencers.snc` sería un registro operativo interno; `Scence` tendría la presencia comercial; la org `SCENCE SpA` (brand) sería un residuo de un registro anterior. **No se ha decidido** qué registro (si alguno) es la marca de pruebas SCENCE SpA; la fundadora indicó que no hace falta decidirlo ahora. No renombrar, fusionar ni borrar.

**Pendiente de decisión o de verificación (no vigente ni implementado).** Detalle, SQL propuesto, riesgos y reversión: `docs/audits/brand_model_hardening_proposal_2026-10-22.md`.

1. *Producción:* confirmar que `xzzbishzfyovrladcaeb` es la base de producción (valor de la variable en Vercel o consola del proveedor).
2. *Linaje entre marcas:* `created_by` está en las 71 marcas (27 usuarios, 45 del usuario administrador) pero identifica a un **usuario**, no a una marca, y `invited_by_organization_id` e `invited_by_brand_id` están vacíos en todas: **no registra qué marca registró a cuál**. Falta una relación marca→marca explícita y su permiso de consulta (decisión de modelo).
3. *Estado de la marca:* ni `resolveBrandAccess` ni RLS leen `brands.status`; una marca `pending_approval`, `rejected` o `suspended` conserva acceso a datos en el servidor. La regla ya está decidida (arriba); falta implementarla (plan P3, requiere aprobación).
4. *Quién registra marcas:* `POST /api/brand/brands` exige cualquier membresía y registra la «org del registrante» como la primera por antigüedad; no hay antiduplicados atómicos ni vínculo fiable persona→marca. La regla ya está decidida (influencers incluidas; sin `brand_manager` automático); falta el registro del registrante y la función atómica (P4, P6).
5. *Aprobación:* las 14 marcas colaboradoras sin correo ya existentes están `approved` sin revisión de SCENCE; se revisan una a una (P8). La ruta ya crea las nuevas como `pending_approval` (corregido en local).
6. *Organizaciones huérfanas y carrera:* cinco rutas crean la organización y luego la marca; un fallo o un registro simultáneo deja organizaciones sin marca (hoy 26 `brand` y 28 `agency`, 4 con «gmail»). No hay índice único de correo de contacto. Limpieza y corrección atómica requieren autorización.
7. *RLS:* `user_can_access_brand` consulta `profiles` (contra §16.2) y conserva cláusulas heredadas; hay políticas de `brand_members` con rol `public`.
8. *Borrado de marcas:* `DELETE /api/brands/[id]` es físico, con cascada amplia, y deja la organización y el usuario de Auth. Decisión: archivar por defecto (P7).
9. *Permisos:* 148 de 154 rutas usan service role; la auditoría de este día cubrió las rutas de marcas, no todas.
10. *Vinculación por correo no verificado:* `ensureBrandRow` vincula una marca sin dueño por correo; falta verificar si producción exige confirmar el correo.
11. *Nombre confuso:* la org `agency` `Scence SpA` se lee como una marca; evaluar un nombre que indique «operación de plataforma» (cambio de datos no autorizado).
12. *Migraciones sin aplicar:* `20261012230000`, `20261021120000`, `20261022120000` y `20261022150000` (esta última sin aplicar y sin revisar en base aislada); falta la comparación completa repo↔base.

**Corregido en local (sin commit):** (a) la búsqueda por correo de contacto en `ensureBrandRow`, `POST /api/brand/brands` y `POST /api/campaigns/[id]/brands`, y por nombre en `influencer/owned-brands`, usa coincidencia exacta (`src/lib/email-match.ts`); antes `_`, `%` y `*` actuaban como comodines; (b) las marcas colaboradoras nuevas nacen `pending_approval`.


### 16.10 Influencer inactiva = cero emails

Una influencer con `is_active = false` no puede recibir ningún email enviado por SCENCE, independientemente del origen, campaña, reserva, términos, Pro, cron, webhook o acción administrativa que genere el envío.

- La barrera final vive en `getResend()` (`lib/resend.ts` → `lib/inactive-influencer-email-guard.ts`) y se aplica a todo `emails.send` y `batch.send`. **Nunca crear otro cliente de Resend ni enviar emails por fuera de `getResend()`.**
- Se evalúa al momento de enviar, no cuando ocurrió la acción: si la desactivan después de postular, aceptar términos o reservar, ningún email posterior sale.
- Por defecto todo envío se trata como dirigido a influencer. Los envíos a marcas, admins, leads CRM o cuentas deben declarar `tags: [emailAudience('brand' | 'admin' | 'crm' | 'account')]`; así, si una marca comparte email con una influencer inactiva, se le sigue escribiendo **solo si la base confirma ese rol**.
- Falla cerrado: si no se puede verificar, no se envía.
- Los filtros `is_active` en las queries de cada ruta se mantienen (contadores exactos y mensajes claros al admin); no reemplazan la barrera.

### 16.11 Ubicación = `locations` (fuente única)

`public.locations` es la **única fuente de verdad de ubicación**. Una sola tabla autorreferenciada (`parent_id`):
`country → region → [city opcional] → commune → place`.

- `level` = nivel jerárquico. `type` = categoría del lugar (solo `place`). No mezclar.
- Geografía (country…commune) = catálogo global, `organization_id NULL`, sin dirección ni coordenadas. Una comuna existe **una vez por región** (cuelgue de la región o de una ciudad).
- `place` = lugar físico: dueño (`organization_id` + `brand_id`/`owner_influencer_id`), `address`, `lat/lng`, `is_private`. `influencer_home` siempre privado.
- La jerarquía la valida la base (`locations_validate_hierarchy`). No duplicar la validación como fuente de verdad en la app.
- Sin DELETE: soft delete con `is_active` (bloqueado si hay hijos activos).
- `/api/locations` es solo admin de plataforma (`isPlatformAdmin`). Incluye domicilios privados: cualquier consumidor no-admin debe filtrar por dueño + `is_private`.
- Consumidores (brands, campaigns, bookings, events) guardan **solo `location_id` → place**. Nunca volver a guardar country/region/city/commune/address en paralelo. País/región/comuna se derivan con `location_breadcrumb()`.
- `brand_locations` es legado: se migra a `locations` y se elimina (Fase 2). No agregarle funcionalidad.

### 16.12 Facturas: propiedad, aislamiento y acceso compartido

La propiedad de una factura es `invoices.owner_brand_id` (migración `20261022120000`, pendiente de aplicar tras revisión). **No** es `organization_id` (organización contable) ni `brand_id` (marca receptora/pagadora).

- Autorizar SIEMPRE con `authorizeInvoice()` / `decideInvoiceAccess()` (`src/lib/invoice-access.ts`); toda ruta de facturas la usa. No reintroducir comparaciones por `organization_id`.
- `owner_brand_id` NULL (SCENCE o histórica) = ninguna marca accede. **Nunca** asignar propietario por suposición; solo por decisión de un administrador, con evidencia.
- La propiedad la deriva el servidor de la sesión; un payload con otra marca u organización se rechaza (403).
- Sin acceso → 404 (no revela existencia). Con lectura pero sin permiso para la acción → 403.
- Acceso compartido = fila activa en `invoice_shares`; solo lectura, nunca re-compartir. `void` y `mark_overdue` son exclusivos de SCENCE.
- `invoices` e `invoice_line_items` solo se escriben por rutas con service role; la lectura directa queda reservada al admin de plataforma.

## 17. Modo SCENCE — forma de trabajo (permanente)

La fundadora entrega **objetivos**, no instrucciones paso a paso. El agente analiza, decide lo obvio e implementa la solución más simple y correcta. Complementa las secciones 6, 11 y 12; el flujo completo de un requerimiento está en la sección 18.

- **Auditar antes de cambiar:** entender cómo funciona hoy, cuál es la fuente de verdad y qué se puede reutilizar.
- **Reutilizar antes de crear** (sección 6). Nada de componentes, tablas, APIs, migraciones, estados o configuraciones que el objetivo no necesite.
- **Una sola fuente de verdad:** no duplicar datos ni crear estados paralelos.
- **Simplificar:** si se resuelve eliminando código, eliminarlo. Menos código es mejor si logra lo mismo.
- **Proteger lo que funciona:** no tocar funcionalidades no relacionadas. No mezclar problemas independientes; cambios pequeños y verificables.
- **Legacy:** identificar consumidores reales; si no tiene y la limpieza está aprobada, se elimina. No mantener nada "por si acaso".
- **Preguntar solo lo necesario:** decidir lo que se infiere del contexto. Detenerse solo ante decisiones de negocio o riesgo real sobre datos, dinero, usuarios, seguridad o comportamiento de negocio (Regla Cero).
- **Datos de producción:** identificar los registros exactos, previsualizar, revisar dependencias y pedir aprobación antes de cualquier escritura destructiva o sensible.
- **Antes de merge:** TypeScript, lint, build y el comportamiento relevante verificados (16.7). Commit, push, deploy y migraciones siguen requiriendo autorización explícita (sección 11).
- **Revisión local:** los cambios se dejan listos para revisar en `localhost:3000` antes de subirlos (reglas de uso en la sección 18, «Entorno de desarrollo»).

Formato de respuesta (breve): **RESULTADO** · **CAMBIOS** · **VERIFICACIÓN** · **RIESGOS / DECISIONES** (solo si existen) · **SIGUIENTE PASO** (una acción). Si no hizo falta cambiar nada, decirlo. No devolver listas de instrucciones para que la fundadora las repita. Al entregar un requerimiento, este formato se amplía como indica la sección 18 (paso 10).

Prioridad: menos código, menos tablas, menos duplicación, menos estados, menos legacy, menos mantenimiento, más claridad.

## 18. Protocolo permanente de implementación SCENCE

Se aplica a cada requerimiento de la fundadora. **No reemplaza** las secciones 0, 11, 12, 16 y 17: las ordena en un flujo y las cita en vez de repetirlas. Si dos reglas chocan, prevalece la más estricta (Regla Cero y sección 11).

**Flujo (en este orden). Un paso que no aplique se declara «No aplica» con su motivo; nunca se omite en silencio.**

1. **REQUERIMIENTO.** Entender el objetivo, el resultado esperado y los criterios de aceptación. Preguntar solo por decisiones importantes que falten (sección 17).
2. **AUDITORÍA** (solo lectura). Revisar código, arquitectura, portal, componentes, APIs, base de datos, permisos y RLS, documentación y regresiones potenciales. Aplican la sección 11 (antes de modificar) y la 12 (si es un bug). **No se modifica código antes de terminar la auditoría y definir el plan.**
3. **PLAN.** Causa raíz, solución mínima, archivos afectados, riesgos y pruebas necesarias. Reutilizar > modificar > crear (sección 6). Si el cambio toca la Regla Cero (visibilidad, postulación, aprobación, briefs, datos de marcas o influencers, pagos, ownership o permisos), **el plan se presenta y se espera aprobación antes de implementar.**
4. **IMPLEMENTACIÓN.** Solo lo que el requerimiento necesita; no mezclar funcionalidades ajenas (sección 17). Sin modificar producción.
5. **DOCUMENTACIÓN.** Actualizar los documentos pertinentes (requerimientos, diseño funcional, arquitectura, registro de cambios) **en su fuente única**, sin crear copias. Las reglas de negocio viven en este archivo. Las fuentes por tipo de información y la nomenclatura están en `docs/00-MASTER/GUIA-DE-DOCUMENTACION_v1.0_2026-10-19.md` (es una **propuesta documental pendiente de aprobación**: **no prevalece** sobre las reglas oficiales de este archivo ni oficializa las fuentes en conflicto, como el FDD principal). Hoy no existe un archivo de registro de cambios: no se crea uno sin aprobación; mientras tanto la entrega (paso 10) es el registro.
6. **TESTING.** Ejecutar `npm test` y las pruebas de integración o específicas relevantes que existan. Las de integración solo contra su base de pruebas, nunca contra producción, y sin pasar claves por el chat (ver `tests/integration/run-crm-integration.sh`). **No se afirma que un test pasó si no se ejecutó.**
7. **QA.** Revisar funcionalidad, UI, APIs, base de datos, permisos y RLS, casos límite, casos de otros roles y regresiones relevantes (sección 11).
8. **SMOKE TESTS.** Flujos críticos en local o en un Preview seguro, según corresponda; los cambios se dejan listos para revisión local (sección 17). Sin autorización, **no** ejecutar acciones con efectos externos: correos reales (Resend, envío masivo del CRM), cobros (PayPal), mensajes (WhatsApp) ni escrituras en datos reales. Antes de cualquier smoke test que escriba datos, confirmar a qué base apunta el entorno (ver «Entorno de desarrollo»).
9. **VALIDACIÓN FINAL.** TypeScript, lint, tests y build según el proyecto y los cambios (16.7, con la fuente simulada en sandbox), más la revisión del diff (sección 11). Lo que no pueda ejecutarse se declara con su motivo y queda **pendiente**.
10. **ENTREGA.** Formato de la sección 17, ampliado: **RESULTADO** (terminado, incompleto o bloqueado, con su motivo; ver «Criterio de cierre») · **CAMBIOS** (archivos modificados y documentación actualizada) · **VERIFICACIÓN** (pruebas con PASS/FAIL, smoke tests) · **RIESGOS / DECISIONES / PENDIENTES** · **ESTADO** (despliegue) · **SIGUIENTE PASO** (una acción). Debe quedar la trazabilidad requerimiento → archivos → documentación → pruebas → resultado.

**Proporcionalidad y revisión de seguridad.** Testing, QA y smoke tests (pasos 6 a 8) son **proporcionales al alcance y al riesgo** del requerimiento. **Toda prueba omitida se justifica por escrito en la entrega.** Los cambios de autenticación, autorización, RLS, facturación o permisos exigen además una **revisión de seguridad pertinente**, registrada en la entrega: rutas y APIs afectadas, chequeo de permisos en backend (no solo en frontend), RLS, y casos de los otros roles (secciones 7, 11 y 16.2).

**Criterio de cierre.** Un requerimiento solo se declara **terminado** cuando cumple los criterios de aceptación **y** las verificaciones aplicables. Si quedan pruebas fallidas o pendientes, se declara **incompleto** o **bloqueado**, indicando el motivo y qué falta para cerrarlo.

**Entorno de desarrollo: `localhost:3000`.** Es la dirección fija de desarrollo y de pruebas visuales (aplica al flujo anterior: implementar → probar en localhost → QA y smoke tests → revisar resultados → pedir aprobación antes de commit, merge o deploy).

- **Repositorio y cambios:** trabajar en el repositorio y la rama o worktree que corresponda, preservando todos los cambios existentes sin commit. No sobrescribir ni revertir cambios ajenos.
- **Servidor:** antes de iniciarlo, comprobar si ya funciona en el puerto 3000 y reutilizarlo cuando corresponda. No iniciar servidores duplicados ni cambiar de puerto en silencio.
- **Puerto ocupado por otro proceso:** identificarlo antes de actuar. No terminar procesos ni cambiar de puerto sin autorización.
- **`localhost` no es base local:** usar `localhost:3000` no implica usar una base de datos local. Antes de cualquier operación que escriba datos, comprobar el destino de Supabase **sin exponer secretos** (solo el ref del proyecto, nunca claves).
- **Producción:** nunca ejecutar pruebas que escriban datos en producción (sección 17, «Datos de producción»). Si el entorno apunta a producción, detener esas pruebas y comunicarlo.
- **Base aislada no disponible:** si una prueba la requiere y aún no existe, indicar qué falta y detener **solo esa prueba**; continuar con las verificaciones locales que sí sean seguras.
- **Herramientas:** no instalar Docker, cambiar dependencias ni incorporar herramientas nuevas como requisito del desarrollo habitual.
- **Verificación visual:** no se declara «verificado visualmente» (nivel «Verificado en Preview» o equivalente local) algo que no se abrió y comprobó realmente en el navegador. Si no se abrió, se marca «Por verificar».

**Reglas obligatorias**

- No duplicar componentes, APIs, tablas ni documentación si se puede reutilizar lo existente (secciones 6 y 17).
- Sin migraciones destructivas, cambios de permisos, despliegues ni acciones con efectos reales sin autorización explícita (sección 11).
- Producción en **solo lectura** durante auditorías y verificaciones no autorizadas (sección 17, «Datos de producción»).
- Separar siempre cuatro niveles: **Implementado · Probado** (ejecutado, con resultado) **· Verificado en Preview · Confirmado en producción.** Lo que no se verificó se marca «Por verificar».
- Si una prueba falla: investigar la causa raíz; no ocultarla ni marcar el requerimiento como terminado.
- Commit, push, merge o deploy solo con autorización para ese trabajo (sección 11); la autorización de uno no se extiende a los demás. Nunca `git add -A` sin autorización.
- Si un cambio no es seguro o falta una decisión crítica: detenerse y consultar a la fundadora.
- **Worktrees:** al iniciar un trabajo en un worktree (`.claude/worktrees/*`), comparar su `CLAUDE.md` con el de la raíz (solo lectura). Si difiere, **advertir** a la fundadora de que sus instrucciones pueden estar desactualizadas. No actualizarlo ni modificarlo automáticamente.
- Trabajo solo documental: aplican los pasos 1, 2, 3, 5 y 10; los pasos 6 a 9 solo si hay algo que ejecutar, y nunca se declara ejecutado lo que no se ejecutó.

## Regla final para Claude

Antes de escribir código, piensa como:

1. Product Manager
2. Principal Architect
3. Security Auditor
4. Business Owner

Primero protege el negocio.

Después simplifica la experiencia.

Después reutiliza lo existente.

Después implementa el cambio mínimo.

Y siempre pregunta: "¿Esto ayuda a que SCENCE se venda, se use y se mantenga?"

Si la respuesta es no, cuestionar si realmente necesitamos construirlo.
