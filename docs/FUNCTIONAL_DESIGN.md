# SCENCE — Functional Design Document (FDD)
**Versión:** 1.0 | **Fecha:** 2026-06-03 | **Estado:** Aprobado para revisión

---

## 1. Executive Summary

SCENCE es una plataforma SaaS B2B de gestión de campañas de influencer marketing. Permite a agencias de marketing y marcas gestionar el ciclo completo de una campaña: desde la búsqueda y contratación de influencers hasta la aprobación de contenido, facturación y pago.

**Producto actual:** Plataforma multi-portal con tres tipos de usuario: Admin (agencia/SCENCE), Marca y Influencer.

**URL producción:** https://scence-app.vercel.app  
**Stack:** Next.js 14, Supabase, Vercel  
**Moneda base:** CLP (Peso chileno)

---

## 2. Objetivos del sistema

1. **Centralizar** la gestión de campañas de influencer marketing en un solo sistema
2. **Automatizar** el flujo de trabajo: invitación → aceptación → entregables → aprobación → pago
3. **Self-service** para marcas: crear campañas y contratar influencers sin intermediación obligatoria
4. **Transparencia** para influencers: ver sus campañas, entregar contenido y ver sus pagos
5. **Control** para el admin de SCENCE: visibilidad total, capacidad de intervención sin ser cuello de botella
6. **Escalabilidad** SaaS: facturación por suscripción, múltiples clientes (organizaciones)

---

## 3. Alcance

### Dentro del alcance (implementado o en construcción)
- Gestión completa de campañas (crear, editar, activar, cerrar)
- Catálogo de influencers con datos de redes sociales
- Flujo de invitación (private) y postulación (open)
- Entrega y aprobación de contenido (deliverables)
- Facturación a marcas (invoices) con IVA 19%
- Payroll a influencers
- Bookings / Eventos
- Afiliados con tracking de links
- Portal self-service para marcas
- Portal para influencers
- AI Campaign Builder
- Instagram Sync vía Apify

### Fuera del alcance (no implementado)
- App móvil nativa
- Integración con plataformas de pago (Stripe para marcas — scaffold listo)
- Contratos digitales con firma electrónica (DocuSign)
- Tracking de performance post-publicación (views, likes en tiempo real)
- Marketplace público de influencers

---

## 4. Actores del sistema

### 4.1 Admin SCENCE (`role: super_admin | agency_manager`)
**Descripción:** Equipo interno de SCENCE. Acceso total a todos los datos de la plataforma.  
**Responsabilidades:**
- Gestionar el roster de influencers
- Supervisar campañas de todas las marcas
- Emitir facturas y gestionar payroll
- Intervenir en cualquier flujo cuando sea necesario
- Gestionar tickets y soporte

### 4.2 Marca (`is_brand: true` en user_metadata)
**Descripción:** Cliente B2B de SCENCE. Accede al Portal Marca (`/brand/*`).  
**Responsabilidades:**
- Crear y gestionar sus propias campañas
- Buscar e invitar influencers del catálogo SCENCE
- Revisar y aprobar contenido entregado
- Ver sus facturas

### 4.3 Influencer (`is_influencer: true` en user_metadata)
**Descripción:** Creador de contenido. Accede al Portal Influencer (`/dashboard`, `/tasks`, etc.).  
**Responsabilidades:**
- Ver invitaciones a campañas y oportunidades open
- Aceptar o rechazar participación
- Subir contenido (deliverables)
- Ver historial de pagos

---

## 5. Mapa completo de módulos

```
SCENCE Platform
├── Auth (compartido)
│   ├── Login
│   ├── Registro Admin/Agencia
│   ├── Registro Marca (self-service)
│   ├── Forgot Password
│   └── Reset Password
│
├── Portal Admin (/  sin prefijo)
│   ├── Dashboard
│   ├── Campaigns
│   │   ├── Lista
│   │   ├── Nueva (manual + AI Builder)
│   │   ├── Detalle
│   │   ├── Editar
│   │   ├── Agregar Influencer
│   │   └── PDF Report
│   ├── Influencers
│   │   ├── Lista/Grid
│   │   ├── Nuevo
│   │   ├── Perfil/Detalle
│   │   ├── Editar
│   │   └── Data Quality (dedup, merge, sync IG)
│   ├── Brands
│   │   ├── Lista
│   │   └── Detalle / Invitar Portal
│   ├── Bookings
│   ├── Billing
│   │   ├── Invoices
│   │   └── Payroll
│   ├── Affiliates
│   ├── Events
│   ├── Analytics
│   ├── Tickets
│   └── Settings
│       ├── Perfil
│       ├── Organización
│       └── Team Members
│
├── Portal Marca (/brand/*)
│   ├── Dashboard
│   ├── Campañas
│   │   ├── Nueva
│   │   ├── Detalle
│   │   ├── Invitar Influencer
│   │   └── Postulaciones
│   ├── Catálogo Influencers
│   └── (pendiente) Billing / Perfil
│
└── Portal Influencer (/dashboard, /tasks, etc.)
    ├── Dashboard
    ├── Mis Campañas
    ├── Tasks / Deliverables
    ├── Mis Marcas
    ├── Perfil
    └── (pendiente) Invitaciones / Oportunidades
```

---

## 6. Mapa de navegación

### Portal Admin
```
/ → Dashboard
/campaigns → Lista de campañas
/campaigns/new → Crear campaña
/campaigns/[id] → Detalle campaña
/campaigns/[id]/edit → Editar campaña
/campaigns/[id]/influencers/add → Agregar influencer a campaña
/campaigns/[id]/report → Reporte PDF
/influencers → Lista/grid de influencers
/influencers/new → Alta de influencer
/influencers/[id] → Perfil influencer
/influencers/[id]/edit → Editar influencer
/influencers/data-quality → Deduplicación + sync IG
/brands → Lista de marcas
/bookings → Gestión de bookings/eventos
/billing → Invoices + Payroll (tabs)
/affiliates → Links de afiliado
/events → Eventos
/analytics → Dashboard analítico
/tickets → Bug tracker / soporte
/settings/profile → Perfil de usuario
/settings/organization → Config de organización
```

### Portal Marca
```
/brand/dashboard → Dashboard principal
/brand/campaigns → Redirige a dashboard (Fase C: lista)
/brand/campaigns/new → Crear nueva campaña
/brand/campaigns/[id] → Detalle de campaña + deliverables
/brand/campaigns/[id]/invite → Invitar influencer
/brand/campaigns/[id]/applications → Ver y gestionar invitaciones/postulaciones
/brand/influencers → Catálogo con filtros
```

### Portal Influencer
```
/dashboard → Dashboard influencer
/my-campaigns → Mis campañas activas
/tasks → Deliverables a completar
/my-brands → Marcas con las que trabajo
/campaign/[id] → Detalle de campaña
/profile → Mi perfil
```

### Auth (público)
```
/login
/register → Registro admin/agencia
/register/brand → Registro marca self-service
/forgot-password
/reset-password
/terms
/privacy
/track/[code] → Redirect de link afiliado
```

---

## 7. Todas las vistas del sistema

### 7.1 Portal Admin

| Vista | Ruta | Estado |
|---|---|---|
| Dashboard | `/` | EXISTE |
| Lista Campañas | `/campaigns` | EXISTE |
| Nueva Campaña | `/campaigns/new` | EXISTE |
| Detalle Campaña | `/campaigns/[id]` | EXISTE |
| Editar Campaña | `/campaigns/[id]/edit` | EXISTE |
| Agregar Influencer | `/campaigns/[id]/influencers/add` | EXISTE |
| Reporte PDF | `/campaigns/[id]/report` | EXISTE |
| Lista Influencers | `/influencers` | EXISTE |
| Nuevo Influencer | `/influencers/new` | EXISTE |
| Perfil Influencer | `/influencers/[id]` | EXISTE |
| Editar Influencer | `/influencers/[id]/edit` | EXISTE |
| Data Quality | `/influencers/data-quality` | EXISTE |
| Lista Brands | `/brands` | EXISTE |
| Bookings | `/bookings` | EXISTE |
| Billing | `/billing` | EXISTE |
| Analytics | `/analytics` | EXISTE |
| Tickets | `/tickets` | EXISTE |
| Settings Perfil | `/settings/profile` | EXISTE |
| Settings Org | `/settings/organization` | EXISTE |

### 7.2 Portal Marca

| Vista | Ruta | Estado |
|---|---|---|
| Dashboard | `/brand/dashboard` | EXISTE |
| Lista Campañas | `/brand/campaigns` | PARCIAL (redirect) |
| Nueva Campaña | `/brand/campaigns/new` | EXISTE |
| Detalle Campaña | `/brand/campaigns/[id]` | EXISTE |
| Invitar Influencer | `/brand/campaigns/[id]/invite` | EXISTE |
| Postulaciones | `/brand/campaigns/[id]/applications` | EXISTE |
| Catálogo Influencers | `/brand/influencers` | EXISTE |
| Billing Marca | `/brand/billing` | NO IMPLEMENTADO |
| Perfil Marca | `/brand/profile` | NO IMPLEMENTADO |

### 7.3 Portal Influencer

| Vista | Ruta | Estado |
|---|---|---|
| Dashboard | `/dashboard` | EXISTE |
| Mis Campañas | `/my-campaigns` | EXISTE |
| Tasks | `/tasks` | EXISTE |
| Mis Marcas | `/my-brands` | EXISTE |
| Perfil | `/profile` | EXISTE |
| Detalle Campaña | `/campaign/[id]` | EXISTE |
| Invitaciones | `/invitations` | NO IMPLEMENTADO |
| Oportunidades Open | `/opportunities` | NO IMPLEMENTADO |
| Historial Pagos | `/earnings` | NO IMPLEMENTADO |

---

## 8. Pantallas — detalle completo

### 8.1 Dashboard Admin

**Objetivo:** Vista ejecutiva del estado del negocio.  
**Usuario:** Admin  
**Campos mostrados:** Campañas activas, Total influencers, Ingresos del mes (CLP), Payroll del mes (CLP), Margen (CLP y %), gráfico de revenue/payroll 6 meses, deliverables pendientes, actividad reciente.  
**Acciones:** Navegar a cualquier módulo.  
**API:** `GET /api/dashboard`  
**Tablas:** `campaigns`, `influencers`, `invoices`, `payroll_runs`, `campaign_deliverables`  
**Reglas de negocio:** Solo muestra datos de la organización del usuario. Si no tiene org, retorna ceros.

---

### 8.2 Lista de Campañas (Admin)

**Objetivo:** Ver y filtrar todas las campañas de la organización.  
**Usuario:** Admin  
**Campos:** Nombre, tipo, estado, marca, número de influencers, progreso de deliverables, fechas.  
**Acciones:** Crear nueva, acceder al detalle, filtrar por estado/tipo/marca, AI Builder.  
**API:** `GET /api/campaigns`  
**Tablas:** `campaigns`, `brands`, `campaign_influencers`, `campaign_deliverables`  
**Reglas:** Filtrado por org_id, paginación server-side.

---

### 8.3 Crear Campaña (Admin)

**Objetivo:** Alta de campaña con todos sus parámetros.  
**Usuario:** Admin  
**Campos:** Nombre*, tipo*, visibility (private/open)*, descripción, brand, fechas, presupuesto, plataformas, hashtags, menciones, lineamientos, deliverable templates, commission_rate.  
**Acciones:** Guardar (status=draft), AI Builder (genera parámetros via Claude Haiku).  
**API:** `POST /api/campaigns`, `POST /api/campaigns/ai-build`  
**Tablas:** `campaigns`  
**Reglas:** `created_by` = user.id. Admin puede asignar cualquier brand de la org.

---

### 8.4 Detalle Campaña (Admin)

**Objetivo:** Vista operacional completa de la campaña.  
**Usuario:** Admin  
**Campos:** Info general, influencers asignados con status/fee, deliverables por influencer con estado y URLs.  
**Acciones:** Cambiar status de campaña, agregar/remover influencer, editar deliverable, descargar PDF report, enviar emails de notificación.  
**API:** `GET /api/campaigns/[id]`, `POST/DELETE/PATCH /api/campaigns/[id]/influencers`, `GET/PATCH /api/campaigns/[id]/deliverables`  
**Tablas:** `campaigns`, `campaign_influencers`, `campaign_deliverables`, `brands`

---

### 8.5 Data Quality (Admin)

**Objetivo:** Mantener la calidad del roster de influencers.  
**Usuario:** Admin  
**Campos:** Duplicados detectados (por username IG o nombre similar), influencers sin Instagram, lista para sync.  
**Acciones:** Merge de duplicados (elige influencer principal), hard delete, sync Instagram (llama a Apify → actualiza followers).  
**API:** `GET /api/influencers/duplicates`, `POST /api/influencers/merge`, `DELETE /api/influencers/bulk-delete`, `POST /api/influencers/sync-instagram`  
**Tablas:** `influencers`, `influencer_social_profiles`

---

### 8.6 Dashboard Marca

**Objetivo:** Resumen del estado de las campañas de la marca.  
**Usuario:** Marca  
**Campos:** KPIs (campañas activas, influencers, deliverables para revisar), sección de contenido para revisar, lista de todas sus campañas con progreso.  
**Acciones:** Navegar a detalle de campaña, aprobar/rechazar contenido directamente desde el card.  
**API:** `GET /api/brand/campaigns`  
**Tablas:** `brands`, `campaigns`, `campaign_influencers`, `campaign_deliverables`  
**Reglas:** Solo ve campañas donde `campaigns.brand_id = brand.id`.

---

### 8.7 Crear Campaña (Marca)

**Objetivo:** Self-service para que la marca lance campañas sin intermediación de SCENCE.  
**Usuario:** Marca  
**Campos:** Nombre*, tipo* (Paid Post/Gifted/Evento/Ambassador), visibility* (Private/Open), descripción, fechas, presupuesto, plataformas, hashtags, lineamientos. Si Open: deadline postulaciones, cupo máximo.  
**Acciones:** Crear → redirige a detalle de campaña.  
**API:** `POST /api/brand/campaigns`  
**Tablas:** `campaigns`  
**Reglas:** `brand_id` y `created_by_brand_id` = brand.id del usuario. Status inicial = `draft`.

---

### 8.8 Catálogo de Influencers (Marca)

**Objetivo:** Búsqueda y selección de influencers para invitar a campañas.  
**Usuario:** Marca  
**Campos visibles:** Nombre, avatar, bio, categorías, ciudad/país, plataforma/username/seguidores/engagement, tarifa referencial.  
**Campos ocultos (para marca):** Email, teléfono, tarifas históricas de otras marcas.  
**Filtros:** Búsqueda por nombre, plataforma, categoría.  
**Acciones:** Invitar a campaña (si viene con ?campaignId) o navegar a invitación.  
**API:** `GET /api/brand/influencers`, `GET /api/brand/influencers/[id]`  
**Tablas:** `influencers`, `influencer_social_profiles`, `influencer_rate_cards`  
**Reglas:** Solo influencers `is_active=true` de la misma org.

---

### 8.9 Invitar Influencer (Marca)

**Objetivo:** Enviar invitación formal con oferta económica y spec de deliverables.  
**Usuario:** Marca  
**Campos:** Influencer seleccionado (card con datos), tarifa propuesta (CLP), mensaje, lista de deliverables (tipo, cantidad, fecha).  
**Acciones:** Enviar invitación, cambiar influencer (vuelve al catálogo), agregar/quitar entregables.  
**API:** `POST /api/brand/campaigns/[id]/invite`, `GET /api/brand/influencers/[id]`  
**Tablas:** `campaign_influencers`  
**Reglas:** origin='invitation', application_status='pending'. No duplica si ya existe invitación. Solo influencers activos de la misma org.

---

### 8.10 Postulaciones (Marca)

**Objetivo:** Ver y gestionar invitaciones enviadas y postulaciones recibidas.  
**Usuario:** Marca  
**Campos:** Card por postulante con datos del influencer, origin (invitación/postulación), mensaje, fee, deliverables spec, botones de acción.  
**Acciones:** Aceptar → crea deliverables automáticamente + activa campaña. Rechazar. Ver historial de gestionadas.  
**API:** `GET /api/brand/campaigns/[id]/applications`, `PATCH /api/brand/campaigns/[id]/applications`  
**Tablas:** `campaign_influencers`, `campaign_deliverables`, `campaigns`  
**Reglas:** Solo puede gestionar applications pendientes. Al aceptar: verifica no hay deliverables previos, crea desde `deliverables_spec`, actualiza campaign.status a 'active' si era draft/pending.

---

### 8.11 Dashboard Influencer

**Objetivo:** Vista personal del influencer sobre su trabajo activo.  
**Usuario:** Influencer  
**Campos:** Campañas activas, tareas pendientes (deliverables), próximos bookings.  
**Acciones:** Ir a deliverable, ver campaña.  
**API:** `GET /api/influencer/campaigns`, `GET /api/influencer/tasks`  
**Tablas:** `campaign_influencers`, `campaign_deliverables`, `bookings`

---

### 8.12 Tasks / Deliverables (Influencer)

**Objetivo:** Gestionar las entregas de contenido.  
**Usuario:** Influencer  
**Campos:** Lista de deliverables con tipo, campaña, fecha límite, status, URL de contenido enviado.  
**Acciones:** Subir URL de contenido, agregar notas, marcar como completado.  
**API:** `GET /api/influencer/tasks`, `PATCH /api/influencer/tasks/[id]`, `POST /api/influencer/deliverables/[id]/submit`  
**Tablas:** `campaign_deliverables`  
**Reglas:** Solo ve sus propios deliverables. Status: pending → submitted (influencer) → approved/rejected (marca o admin).

---

## 9. Acciones disponibles por pantalla

### Resumen de acciones por rol

| Acción | Admin | Marca | Influencer |
|---|---|---|---|
| Crear campaña | ✅ | ✅ | ❌ |
| Editar campaña propia | ✅ | ✅ (pre-activa) | ❌ |
| Editar campaña ajena | ✅ | ❌ | ❌ |
| Ver catálogo completo influencers | ✅ | ✅ (limitado) | ❌ |
| Invitar influencer | ✅ | ✅ | ❌ |
| Postular a campaña open | ❌ | ❌ | ✅ |
| Aceptar/rechazar postulación | ✅ | ✅ | ❌ |
| Aceptar/rechazar invitación | ✅ (forzar) | ❌ | ✅ |
| Subir deliverable | ❌ | ❌ | ✅ |
| Aprobar deliverable | ✅ | ✅ | ❌ |
| Emitir invoice | ✅ | ❌ | ❌ |
| Ver invoice propia | ✅ | ✅ | ❌ |
| Ejecutar payroll | ✅ | ❌ | ❌ |
| Ver payroll propio | ❌ | ❌ | ✅ |
| Cancelar campaña | ✅ | ✅ (propia) | ❌ |
| Reasignar influencer | ✅ | ❌ | ❌ |
| Sync Instagram | ✅ | ❌ | ❌ |
| Ver Data Quality | ✅ | ❌ | ❌ |
| Acceder a tickets | ✅ | ❌ | ❌ |

---

## 10. Reglas de negocio

### RN-01: Multi-tenancy
Todo dato está scoped por `organization_id`. Un usuario solo ve datos de su organización. Se implementa con `createAdminClient()` + `WHERE organization_id = orgId` en todas las queries.

### RN-02: Roles de usuario
- `super_admin` / `agency_manager`: acceso completo al portal admin
- `brand_manager` + `is_brand=true`: acceso solo al portal marca
- `influencer` + `is_influencer=true`: acceso solo al portal influencer
- El middleware en `src/middleware.ts` enforza el routing por rol

### RN-03: Campañas private vs. open
- `private`: solo la marca puede agregar influencers por invitación
- `open`: los influencers pueden postular. La marca acepta/rechaza. La marca también puede invitar directo.

### RN-04: Auto-creación de deliverables
Al aceptar una invitación/postulación (`application_status → accepted`), el sistema crea automáticamente los `campaign_deliverables` desde `deliverables_spec` del `campaign_influencers`. Si la campaña estaba en draft/pending_influencers, pasa a `active`.

### RN-05: Deliverables_spec es inmutable
Una vez creada la invitación, `deliverables_spec` no se modifica. Es el "contrato informal" de lo acordado. Los `campaign_deliverables` son la fuente de verdad operacional.

### RN-06: Visibilidad de datos entre portales
- La marca NO ve: email/teléfono de influencers, tarifas históricas con otras marcas, campañas de otras marcas
- El influencer NO ve: tarifas de otros influencers, datos financieros de la campaña, datos de otras marcas

### RN-07: Status de campaña
- Una campaña con al menos un influencer aceptado pasa a `active`
- No se puede invitar a campañas `completed` o `canceled`
- El admin puede cambiar el status manualmente en cualquier momento

### RN-08: IVA en facturación
Todas las facturas incluyen IVA 19% (Chile). El sistema calcula `tax_amount = subtotal * 0.19`.

### RN-09: Moneda CLP
La moneda por defecto es CLP en todos los módulos. El schema soporta otras monedas (`currency_code` ENUM) pero la UI siempre muestra CLP.

### RN-10: Brand self-registration
Cuando una marca se registra por `/register/brand`, el sistema auto-crea un registro en `brands` table vinculado a la primera `organization` existente (la org de SCENCE). El primer login llama a `POST /api/brand/register`.

---

## 11. Flujos completos

### 11.1 Registro Marca (self-service)

```
1. Marca accede a /register/brand
2. Completa: nombre de marca, nombre de contacto, email, contraseña
3. signUp → is_brand=true, brand_name en user_metadata
4. Email de confirmación enviado
5. Marca hace clic en el link → /auth/callback → redirect /brand/dashboard
6. Layout detecta is_brand=true → llama POST /api/brand/register
7. API crea brands record: org_id = primera org de SCENCE, user_id = auth.uid
8. Dashboard carga con datos vacíos — lista para crear primera campaña
```

### 11.2 Creación de campaña (Marca)

```
1. /brand/campaigns/new
2. Completa: nombre, tipo, visibility (private/open)
3. Si open: define deadline y cupo máximo
4. Agrega fechas, presupuesto, plataformas, lineamientos
5. POST /api/brand/campaigns → campaigns.status = 'draft'
6. Redirect a /brand/campaigns/[id]
7. Campaña en estado draft — lista para invitar influencers
```

### 11.3 Invitación influencer (campaña private)

```
1. Marca va a /brand/influencers?campaignId=[id]
2. Busca y filtra influencers
3. Click "Invitar a campaña" → /brand/campaigns/[id]/invite?influencerId=[infId]
4. GET /api/brand/influencers/[infId] → carga datos del influencer
5. Marca completa: fee propuesta, mensaje, lista de deliverables
6. POST /api/brand/campaigns/[id]/invite
7. Crea campaign_influencers: origin='invitation', application_status='pending', deliverables_spec=[...]
8. Influencer ve la invitación en su portal (PENDIENTE: UI /invitations)
9. Influencer acepta → PATCH application_status='accepted'
10. Auto-crea campaign_deliverables desde deliverables_spec
11. campaign.status → 'active' si era draft
```

### 11.4 Postulación (campaña open)

```
1. Campaña creada con visibility='open'
2. Influencer ve en /opportunities (PENDIENTE: UI)
3. GET /api/influencer/campaigns/open → retorna campañas open activas
4. Influencer hace click "Postular" + escribe mensaje
5. POST /api/influencer/campaigns/[id]/apply
6. Crea campaign_influencers: origin='application', application_status='pending'
7. Marca ve en /brand/campaigns/[id]/applications
8. Marca acepta → misma lógica de auto-deliverables
```

### 11.5 Entrega de deliverables (Influencer)

```
1. Influencer ve deliverables en /tasks
2. Sube URL de contenido + notas
3. POST /api/influencer/deliverables/[id]/submit
4. deliverable.status → 'in_review'
5. Marca ve "X para revisar" en su dashboard
6. Marca va a /brand/campaigns/[id]
7. Revisa el contenido (link externo)
8. PATCH /api/brand/deliverables/[id]/review → action: 'approve' | 'reject'
9. Si approved: status → 'approved'
10. Si rejected: status → 'rejected', review_notes enviadas al influencer
11. Email notification (si Resend configurado)
```

### 11.6 Facturación

```
1. Admin crea invoice en /billing → invoices tab
2. POST /api/invoices → crea factura con IVA 19%
3. Invoice.status = 'draft' → 'sent' → 'paid'
4. Marca ve la factura en /brand/billing (PENDIENTE)
5. Marca paga → admin actualiza status a 'paid'
```

### 11.7 Payroll

```
1. Admin crea payroll run en /billing → payroll tab
2. POST /api/payroll → agrupa pagos a influencers
3. payroll_run.status = 'pending' → 'approved' → 'paid'
4. Influencer ve sus pagos en /my-campaigns (actualmente)
```

---

## 12. Matriz de permisos por rol

| Recurso/Acción | super_admin | agency_manager | brand_manager (is_brand) | influencer (is_influencer) |
|---|---|---|---|---|
| Leer campaigns (todas) | ✅ | ✅ | ❌ (solo propias) | ❌ |
| Crear campaign | ✅ | ✅ | ✅ | ❌ |
| Editar campaign | ✅ | ✅ | ✅ (propia, pre-activa) | ❌ |
| Borrar campaign | ✅ | ✅ | ❌ | ❌ |
| Leer influencers (todos) | ✅ | ✅ | ✅ (limitado) | ❌ |
| Crear/editar influencer | ✅ | ✅ | ❌ | ❌ |
| Invitar influencer | ✅ | ✅ | ✅ | ❌ |
| Postular (aplicar) | ❌ | ❌ | ❌ | ✅ |
| Aceptar/rechazar postulación | ✅ | ✅ | ✅ | ❌ |
| Aceptar/rechazar invitación | ✅ | ✅ | ❌ | ✅ |
| Subir deliverable | ❌ | ❌ | ❌ | ✅ |
| Aprobar deliverable | ✅ | ✅ | ✅ | ❌ |
| Leer invoices | ✅ | ✅ | ✅ (propias) | ❌ |
| Crear invoice | ✅ | ✅ | ❌ | ❌ |
| Leer payroll | ✅ | ✅ | ❌ | ✅ (propio) |
| Crear payroll | ✅ | ✅ | ❌ | ❌ |
| Leer brands | ✅ | ✅ | ✅ (propia) | ❌ |
| Crear brand | ✅ | ✅ | ❌ | ❌ |
| Leer analytics | ✅ | ✅ | ❌ | ❌ |
| Leer tickets | ✅ | ✅ | ❌ | ❌ |
| Sync Instagram | ✅ | ✅ | ❌ | ❌ |
| Data Quality | ✅ | ✅ | ❌ | ❌ |

---

## 13. Estados y transiciones

### Campaign.status

```
draft ──────────────────────────────────────────────────────────► canceled
  │                                                                    ▲
  ▼                                                                    │
pending_influencers ──► active (primer influencer aceptado) ──► completed
                                                               │
                                                               └──► canceled
```

Valores: `draft | pending_influencers | active | paused | completed | canceled`

### campaign_influencers.application_status (NUEVO)

```
pending ──► accepted
       └──► rejected
       └──► expired (futuro: cuando vence sin respuesta)
       └──► withdrawn (influencer retira su postulación)
```

> Nota: existe también `campaign_influencers.status` (ENUM `campaign_status`) — legacy, en desuso para nuevo código.

### campaign_deliverables.status

```
pending ──► submitted (influencer sube contenido)
              ├──► approved (marca o admin aprueba)
              └──► rejected (con notas) ──► submitted (re-entrega)
                                        └──► published (post-aprobación)
```

Valores: `pending | in_review | approved | rejected | published`

### invoice_status

```
draft ──► sent ──► paid
     └──► void
          └──► overdue (si pasa la fecha de vencimiento)
               └──► partially_paid
```

### payroll_status

```
pending ──► approved ──► processing ──► paid
                                   └──► failed
```

---

## 14. Casos de uso

### CU-01: Marca crea campaña privada e invita influencers
**Actor:** Marca  
**Precondición:** Marca autenticada con al menos 1 influencer activo en el catálogo  
**Flujo:** Crear campaña (visibility=private) → Buscar influencer en catálogo → Enviar invitación con fee y deliverables → Influencer acepta → Deliverables creados automáticamente → Campaña activa  
**Postcondición:** `campaign_influencers.application_status = 'accepted'`, `campaign_deliverables` creados, `campaign.status = 'active'`

### CU-02: Marca crea campaña open, influencer postula
**Actor:** Marca + Influencer  
**Precondición:** Marca autenticada, influencer autenticado  
**Flujo:** Marca crea campaña (visibility=open) → Influencer ve en /opportunities → Influencer postula con mensaje → Marca revisa en /applications → Marca acepta → Deliverables creados  
**Postcondición:** Mismo que CU-01

### CU-03: Influencer entrega y marca aprueba contenido
**Actor:** Influencer + Marca  
**Precondición:** Deliverable en status=pending  
**Flujo:** Influencer sube URL → status=in_review → Marca revisa contenido → Aprueba o rechaza con notas → Si rechazado: influencer corrige y re-entrega  
**Postcondición:** `campaign_deliverables.status = 'approved' | 'rejected'`

### CU-04: Admin hace bulk import de influencers
**Actor:** Admin  
**Precondición:** CSV preparado con columnas requeridas  
**Flujo:** /influencers → Bulk Upload modal → CSV upload → POST /api/influencers/bulk → Hasta 1500 influencers por lote  
**Postcondición:** Influencers creados con status=draft

---

## 15. Gaps detectados

| Gap | Descripción | Impacto |
|---|---|---|
| G-01 | Influencer no puede ver invitaciones (`/invitations` no existe) | Alto — el flujo de aceptación no está completo por el lado del influencer |
| G-02 | Influencer no puede ver campañas open (`/opportunities` no existe) | Alto — las campañas open no son usables sin esta UI |
| G-03 | `/brand/campaigns` redirige al dashboard (no hay lista dedicada) | Medio — navegación confusa para marcas con muchas campañas |
| G-04 | Marca no puede ver sus facturas (`/brand/billing` no existe) | Medio — marca no puede hacer seguimiento de pagos |
| G-05 | Marca no puede editar su perfil (`/brand/profile` no existe) | Bajo — datos de perfil solo editables por admin |
| G-06 | No hay notificaciones en tiempo real | Medio — usuario debe refrescar manualmente para ver cambios |
| G-07 | `campaign_influencers.status` ENUM legacy convive con `application_status` TEXT | Técnico — riesgo de inconsistencia de datos |
| G-08 | Email de notificación de invitación no se envía automáticamente al influencer | Medio — el influencer no sabe que tiene una invitación si no entra al portal |
| G-09 | No hay página de perfil público de influencer para marcas | Bajo — `/brand/influencers/[id]` no existe |
| G-10 | No hay flujo de onboarding para marcas nuevas | Bajo — primera experiencia de marca vacía sin guía |

---

## 16. Mejoras recomendadas

| Mejora | Prioridad | Esfuerzo |
|---|---|---|
| M-01 | Implementar /invitations en portal influencer | Alta | Bajo |
| M-02 | Implementar /opportunities en portal influencer | Alta | Bajo |
| M-03 | Envío de email cuando se crea invitación (`POST /api/brand/campaigns/[id]/invite`) | Alta | Muy bajo |
| M-04 | Lista dedicada /brand/campaigns con Nueva Campaña | Alta | Bajo |
| M-05 | /brand/billing — facturas de la marca | Media | Bajo |
| M-06 | Dropear `campaign_influencers.status` ENUM, migrar todo a `application_status` | Media | Medio |
| M-07 | Notificaciones in-app persistentes (tabla `notifications` existe, falta UI) | Media | Medio |
| M-08 | /brand/profile — editar perfil de marca | Baja | Muy bajo |
| M-09 | Onboarding flow para marcas nuevas (tour guiado) | Baja | Alto |
| M-10 | Perfil público de influencer para marca `/brand/influencers/[id]` | Baja | Bajo |
