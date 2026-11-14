# SCENCE — instrucciones permanentes (actualizado 2026-11-14)

Única fuente de instrucciones. `AGENTS.md` y `.claude/agents/` solo apuntan aquí. Historial, cifras, evidencias y pendientes: [docs/audits/CLAUDE_historico_2026-11-14.md](docs/audits/CLAUDE_historico_2026-11-14.md) (consultar solo si hace falta; no es regla vigente).

## 1. Ubicación y ramas

- Única carpeta de desarrollo: `/Users/priscillaperez/Claude/Projects/APP SCENCE/scence-app-clean`. Antes de cualquier comando, verificar `pwd -P` y estado Git; si la carpeta es otra, detenerse.
- Nunca modificar ni publicar desde copias antiguas (`scence`, `scence-app`, `scence-work`, `wt-*`, `*-BACKUP-*`). Respaldos: `SCENCE-Backups`, fuera del repo.
- Solo existen las ramas `staging` (DEV) y `master` (PROD). **Nunca crear ramas, worktrees ni infraestructura paralela.** Los worktrees históricos se conservan sin usarlos.
- Preservar cambios locales ajenos. Nunca force push ni borrar historial.

## 2. Regla Cero

Auditar y explicar la causa antes de modificar comportamiento de negocio. Presentar el impacto y esperar aprobación antes de cambios sensibles en: visibilidad de campañas o briefs, postulaciones, aprobaciones, marcas, influencers, datos privados, pagos, ownership, Auth, triggers, RLS o permisos. Un solo cambio sensible de Auth/triggers/RLS/permisos por vez.

## 3. Principios

- Priorizar ventas, activación y retención; simplificar la gestión de campañas y reducir trabajo manual.
- Reutilizar componentes, vistas, APIs, tablas y helpers; una fuente de verdad por dato. Reutilizar la experiencia de Admin en Marca con el alcance filtrado en servidor.
- Lo oculto en frontend no está protegido: todo dato sensible (briefs, contratos, pagos, marcas, influencers, datos internos) se protege también en backend/API, separado entre ADMIN, MARCA e INFLUENCER.
- Cambios pequeños, verificables, separados por objetivo. No cambiar interfaz o diseños existentes sin autorización. Confirmar consumidores antes de retirar código heredado y pedir aprobación. Si la solución crece o hay decisión crítica pendiente, detenerse y proponer el mínimo.
- Bugs: causa raíz, cambio mínimo, archivos afectados, riesgo y verificación.

## 4. Protocolo de implementación

1. **Auditoría:** qué se entendió, archivos, límites y riesgos; diagnóstico en solo lectura.
2. **Plan:** causa, archivos, cambio mínimo, validación.
3. **Implementación:** solo lo necesario; actualizar la fuente según [la guía de documentación](docs/00-MASTER/GUIA-DE-DOCUMENTACION_v1.0_2026-10-19.md).
4. **Validación:** `npx tsc --noEmit`, `npx next lint`, `next build` y `npm test` según alcance (sin acceso a Google Fonts, el build usa `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`). Revisar diff, rutas y casos por rol. Integración solo contra base de pruebas. Toda prueba omitida se justifica por escrito. Cambios de Auth, autorización, RLS, facturación o permisos exigen además revisión de seguridad registrada (rutas, chequeo backend, RLS, otros roles).
5. **Entrega:** resultado, cambios, verificaciones y pendientes. Distinguir implementado · probado · verificado en Preview · confirmado en producción. «Verificado» solo si se abrió y comprobó en el navegador; si no, «Por verificar».

**Respuestas a la fundadora:** breves y ejecutivas (máx. 5 líneas en tareas simples): qué se encontró, qué se hará, si requiere aprobación. Sin repetir antecedentes, sin preguntar lo resoluble con la información existente; explicación extensa solo si la pide.

Commit, push, merge, deploy y aplicar migraciones requieren autorización explícita para cada acción. No usar `git add -A`.

## 5. Despliegue: LOCAL → DEV (`staging`) → PROD (`master`)

Proceso único (decidido 2026-10-21). No se salta ninguna etapa, ni por urgencia (salvo HOTFIX).

1. **LOCAL** (`localhost:3000`): implementar y validar.
2. **DEV/Preview** (`dev.scence.cl` = rama `staging`, base Supabase `dexpvoubiklgotuukrml`): requiere autorización de commit y push.
3. **PROD**: solo con autorización explícita, por merge revisado `staging` → `master`; sin commits directos ni ramas de trabajo. Verificar después en producción (sin efectos reales no autorizados) y actualizar documentación.

- **Migraciones:** archivo aditivo e idempotente en `supabase/migrations/` con rollback en `supabase/rollbacks/`; los DROP quedan en `supabase/pending/` hasta desplegar el código compatible. Primero DEV, luego PROD con autorización propia y antes de publicar el código que las usa. Su identidad es el nombre, no el prefijo de fecha.
- `READY` en Vercel no equivale a «verificado». Una orden de «publicar directamente» no autoriza saltarse DEV: avisar del conflicto. Solo la palabra «HOTFIX» activa el protocolo siguiente.
- **Preview seguro** = base distinta de producción (comprobar el ref, sin exponer secretos) + claves de terceros vacías o en modo prueba + acceso protegido. Si algo no se confirma, tratarlo como producción: solo verificación visual, sin escrituras, correos, cobros ni mensajes. Detalle de entornos: `SETUP.md` §7.
- **Localhost:** reutilizar el servidor del puerto 3000; no duplicarlo, ni cambiar de puerto, ni matar procesos sin autorización. `localhost` no implica base local: antes de escribir datos, comprobar el ref de Supabase. `.env.local` apunta a DEV; nunca cargar `.env.local.respaldo-produccion`.
- **Producción:** nunca pruebas que escriban datos. En auditorías es solo lectura; antes de una escritura autorizada, identificar registros y previsualizar. Correos, cobros y mensajes reales requieren autorización explícita.
- Sin base aislada disponible: detener solo esa prueba y seguir con las verificaciones locales seguras. No instalar Docker ni herramientas nuevas como requisito.

### HOTFIX (errores pequeños y urgentes en PROD)

Si toca la Regla Cero, migraciones o crece más de lo mínimo: no es HOTFIX, detenerse.

1. Base: `master` actualizado con `git fetch`.
2. Cambio mínimo: solo el error pedido.
3. Pruebas según riesgo (mínimo `tsc`).
4. Publicar con una sola autorización: commit solo con los archivos del arreglo a `master`, sin `staging`.
5. Sincronizar siempre: cherry-pick a `staging` y reconciliar LOCAL sin sobrescribir.
6. Verificar: PROD `READY`, error resuelto, arreglo presente en `staging`.

Conflicto real: detenerse y explicar. Entrega: qué se corrigió, qué se publicó, si quedó sincronizado.

## 6. Invariantes (verificados contra schema y datos reales; no contradecir sin auditar de nuevo)

### 6.1 Campañas y postulaciones
- `campaign_influencers.application_status` (`pending|accepted|rejected`) es la única fuente. **Nunca escribir `campaign_influencers.status`** (enum de campaña; el UPDATE falla en silencio). Toda escritura con admin client revisa `error`.
- Visibilidad: marca ve solo sus campañas; influencer ve campañas publicadas/disponibles, nunca campañas personales de otras ni brief privado/PDF/contenido privado con postulación `pending` (solo info general, descripción pública y estado); con `accepted`, brief completo y PDF. No crear arquitectura nueva si ownership, visibility, status y relaciones ya lo permiten.
- `visibility='private'` ≠ oculta: significa «requiere Plan Pro para postular». Toda influencer ve las privadas activas; gratis → CTA «POSTULAR CON PRO» (`/inf-profile?tab=plan&return_campaign_id=<id>`), Pro → «Postular». Invitación rechazada no bloquea; postulación rechazada por la marca sí oculta. `(campaign_id, influencer_id)` es UNIQUE: re-postular reutiliza la fila con UPDATE. Se excluyen campañas cuyo `created_by` es un `influencers.user_id`.
- Creación de campaña: todo campo nuevo en `POST /api/campaigns` o `/api/brand/campaigns` debe entrar al objeto del insert, no solo al destructuring. Direcciones de campaña: `campaign_locations` → `locations` (§6.6); `metadata.address` es solo una copia de la principal para consumidores heredados, nunca la fuente. El lugar del evento vive en `bookings.location_id`.
- Aviso de campaña disponible: activa y `open` o `private`. Fuente única `resolvePendingCampaignAnnouncement()` (activación, botón manual, contador). Idempotencia en `campaign_influencer_notifications`; respetar `public_campaigns_email`; rutas de envío masivo con `maxDuration = 300`; revisar `error` de Resend en cada envío.

### 6.2 Autorización
- Autorizar SIEMPRE con `organization_members` vía `getUserRole()`, `resolveBrandAccess()` / `hasBrandPermission()`; en campañas, `authorizeCampaignBrandAction()`. **Nunca `profiles.role`** ni un `isAdmin()` local.
- Las rutas con service role omiten RLS: su protección depende del chequeo de cada ruta.

### 6.3 Plan Pro y pagos
- `INFLUENCER_PRO_TERMS.version` se compara exacta con `influencer_terms_acceptances.document_version` en `/apply` y `/paypal/checkout`; al subirla, usar `acceptCurrentInfluencerProTerms()` (`POST /api/influencer/terms`), sin duplicar lógica.
- PayPal es la única pasarela con datos reales. No crear checkouts nuevos: `upgradeToPro()` → `/api/influencer/paypal/checkout` → `/complete`. Pro se deriva de `subscriptions` (`active`/`trialing`) + `influencers.metadata.manual_pro.active`, vía `getInfluencerProStatuses()` / `isInfluencerPro()`.

### 6.4 Marcas, organizaciones y roles
- **SCENCE es la plataforma**; todo lo demás son marcas, sin privilegios por nombre. SCENCE SpA es solo una marca de pruebas. La org técnica `Scence SpA` (`type='agency'`) concentra la operación de plataforma; no es «la marca SCENCE SpA». No renombrar, fusionar ni borrar.
- Solo SCENCE (`super_admin` vía `organization_members`) ve, crea, edita, aprueba, suspende y borra marcas. Registro, confirmación de correo y aprobación son etapas distintas. Toda marca nueva nace `pending_approval` (también las colaboradoras) → `approved|rejected|suspended`; aprobar no crea ni cambia organización. Estado aplicado en servidor por `hasBrandPermission` → `brand-status-access.ts`.
- Cada marca vive en su propia org técnica `type='brand'` (crear con `provisionOrgForBrand()`); acceso por `brand_id`, nunca por `organization_id`. Borrado: archivar/desactivar por defecto; definitivo solo excepcional y autorizado.
- Pueden registrar marcas los usuarios autorizados, incluidas influencers; registrar no concede permisos sobre otras marcas.
- **Roles de marca: solo `owner` (`is_owner`) y `member`.** `member` = operación completa y facturación de su marca; `owner` = además equipo, datos, documentos legales (solo `owner` firma NDA) y pago del plan. `void` y `mark_overdue` de facturas son de SCENCE. Valores heredados (`brand_manager`, `finance`) se normalizan con `normalizeBrandRole()`; invitar/cambiar rol vía `ensureBrandMembership()` (solo `member`). Fuente: `src/lib/brand-permissions.ts`. No recrear la migración `preserve_brand_member_role_sync`.
- Aislamiento: en campañas compartidas, de las otras marcas solo se ve nombre, logo e Instagram público. Agregar/quitar marcas de una campaña: solo Admin o la marca principal con permiso operativo (`created_by_brand_id` si falta `brand_id`).
- **Cartera de colaboradoras** (`brand_collaborators`, direccional: A→B no crea B→A ni acceso). Contactos por relación; notificaciones al contacto de la marca madre que origina la gestión (sin contacto válido, no se envía). Solo `owner` (`team.manage`) y `super_admin` agregan/quitan/editan; los demás solo consultan; la marca sale de la sesión. Solo se vincula una marca existente y `approved` (inexistente o no aprobada = 404 igual; varias = 409). No se crean marcas desde esta función. Sin RLS/privilegios para `anon`/`authenticated`: protege el chequeo de cada ruta.
- **Agencia multimarca (Impulso Consulting)**, excepción acotada: org con `organizations.settings.agency_portal = true`; solo su owner activo administra sus marcas (`metadata.managed_by_org_id`, nacen `approved`), vía `resolveAgencyBrandAccess()` y cookie `scence_active_brand`. Nunca por nombre.
- **Mensualidad (todas las marcas):** sin barrera de pago al entrar ni al crear borradores. `brandHasCurrentSubscription()` se exige solo en «Enviar a aprobación» (402 → checkout PayPal de esa marca, US$79/mes, plan `agency`; solo el owner paga). Vigentes: mensualidad `agency`, suscripción Basic/Growth/Pro con acceso, o `subscription_plan_override`. **El pago nunca activa ni aprueba**: solo `super_admin`. Sin doble cobro (409 `ALREADY_ACTIVE`); solo el backend pasa la suscripción a `active` leyendo PayPal.

### 6.5 Influencers: privacidad y emails
- Una marca solo ve influencers con relación comprobable (postularon, invitadas, participaron, `campaign_brands`, `brand_influencers`); no hay catálogo global para marcas. Fuente única `getBrandInfluencerScope()` en todo endpoint de marca que liste, busque, abra, invite o agregue influencers. Nunca ven email, teléfono, WhatsApp ni `user_id`: toda respuesta a marcas con `influencer` pasa por `src/lib/brand-influencer-privacy.ts`.
- RUT de influencer: privado y opcional, solo en `influencer_private_data` (service role); validar/formatear con `src/lib/rut.ts`. Lo leen/escriben la propia influencer, el Super Admin (ficha, solo lectura) y la exportación. **Exportación de campaña (`/influencers/export`): solo Super Admin**; ninguna marca descarga datos personales. Columnas: `src/lib/campaign-export-columns.ts`.
- Teléfonos visibles: `PhoneLink`/`whatsappUrl()`, sin `tel:` sueltos.
- **Influencer inactiva (`is_active=false`) = cero emails.** La barrera vive en `getResend()` (`lib/resend.ts`); nunca otro cliente Resend. Envíos a marcas/admin/CRM/cuentas declaran `emailAudience(...)`. Falla cerrado.

### 6.6 Ubicación
`public.locations` es la única fuente (`country → region → [city] → commune → place`; `level` ≠ `type`). Geografía global sin dirección; `place` con dueño, `address`, `lat/lng`, `is_private`. Consumidores guardan solo `location_id` → place; nunca country/region/commune/address en paralelo (usar `location_breadcrumb()`). Soft delete con `is_active`. `/api/locations` solo admin de plataforma; consumidores no-admin filtran por dueño + `is_private`. Jerarquía validada por la base. Compartir un `place` entre marcas = fila en `location_brand_shares` (solo propietaria o Admin; la receptora lo usa en sus campañas, solo lectura —el trigger `campaign_locations_validate` lo permite si no es privado ni está desactivado—; no da acceso a campañas ni datos de otra marca; `granted_by` lo fija el servidor; retirar el acceso no rompe campañas históricas). Domicilios de influencer = `place` privado `influencer_home` (varios, uno `is_primary`); solo la dueña y Admin los leen; el envío guarda su dirección en `barter_benefits.shipping_location_id` y cambiar la principal no lo altera. Leads CRM: `crm_leads.location_id` es el vínculo; los textos originales se conservan.

### 6.7 Facturas
Propiedad = `invoices.owner_brand_id` (no `organization_id` ni `brand_id`). Autorizar con `authorizeInvoice()` / `decideInvoiceAccess()` (`src/lib/invoice-access.ts`). `owner_brand_id` NULL = ninguna marca accede; nunca asignarlo por suposición. Propiedad derivada de la sesión (payload ajeno → 403); sin acceso → 404. Acceso compartido = `invoice_shares` activa, solo lectura. Escritura solo por service role.

### 6.8 Entregables y asistencia
Fuentes únicas: `src/lib/deliverable-status.ts` y `src/lib/attendance-state.ts`; prohibido recalcular «completado/pendiente/vencido/confirmada» con listas propias. La confirmación de la influencer no requiere aprobación (`attendance_response` manda; trigger deriva `status`). Toda consulta que alimente `isDeliverableComplete` selecciona `attendance_response`. No modificar filas «sin respuesta vencida» ni aprobadas legadas sin autorización. Plan Pro: `isCommitmentSatisfied` en `influencer-pro-commitment.ts`.

### 6.9 Perfil legal y NDA
Captura y edición solo en `/brand-settings/organization` (Perfil legal); Mi perfil y el modal del NDA no los piden. Fuentes: `brands.rut`, `brands.address_*`, `brands.name`, y `profiles.full_name/signer_rut/signer_role` del owner firmante; no usar `organizations.tax_id` ni `brands.metadata.rut/legal_name`. Reglas solo en `src/lib/brand-legal-profile.ts`. `PATCH /api/brand/documents/[id]` firma con datos registrados (ignora `signer_*`; falta algo → 422 `LEGAL_PROFILE_INCOMPLETE`); un NDA firmado no se modifica.

### 6.10 Soporte
Un solo módulo. Estados `open|in_progress|closed`; prioridad `P0`–`P3`. «Todos» = solo activos. Responder (`saveAdminReply`) pasa Abierto → En progreso; el cierre es manual; el correo sale por `deliverReplyEmail` → `getResend()`. Plantillas en `support_reply_templates`; respuesta masiva exige `confirm:true`. «Actualizar Pro» crea tickets (`category='pro_followup'`) sin enviar correo.

## 7. Documentación y estado

Cifras, estados de migraciones, evidencias por entorno y pendientes no viven aquí: se mantienen en `docs/` según la guía de documentación y en el histórico enlazado arriba.
