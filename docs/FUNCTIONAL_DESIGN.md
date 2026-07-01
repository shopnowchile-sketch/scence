# SCENCE
## Functional Design Document
### Plataforma de gestión de campañas de influencer marketing

**Versión:** 2.1 | **Fecha de emisión:** 2026-07-01

---

## Control de Documento

### Lista de distribución

| Nombre | Rol |
|---|---|
| Priscilla Perez | Founder / Product Owner |
| Equipo SCENCE | Operaciones / Desarrollo |

### Historial de cambios

| Versión | Detalle del cambio | Fecha |
|---|---|---|
| 1.0 | Versión inicial del FDD | (previa a esta auditoría) |
| 2.0 | Auditoría en vivo contra producción (`scence-app.vercel.app`), 3 portales, 25 pantallas documentadas con mockups fieles, 9 bugs encontrados | 2026-07-01 |
| 2.1 | Reestructurado a formato ejecutivo (control de documento, mapa de proceso, requisitos funcionales por portal, reportes, no-funcionales, notificaciones, glosario). Se corrigieron 6 de los 9 bugs encontrados (ver §12, Bugs) | 2026-07-01 |

### Sign-off

| Versión | Nombre | Rol | Fecha | Firma |
|---|---|---|---|---|
| | | | | |

---

## Tabla de Contenidos

1. Introducción
   1.1 Resumen del producto
   1.2 Objetivos
   1.3 Impacto de arquitectura legacy
2. Requisitos de Negocio
   2.1 Mapa de Proceso
   2.2 Flujo de Sistema (arquitectura)
   2.3 Supuestos
   2.4 Restricciones
3. Requisitos Funcionales por Portal
   3.1 Portal Admin
   3.2 Portal Marca
   3.3 Portal Influencer
4. Reportes
5. Convenciones de Estado y Color (Theming)
6. Requisitos de Integración
7. Datos e Importación Masiva
8. Requisitos No-Funcionales
9. Notificaciones por Email
10. Documentos de Apoyo
11. Glosario
12. Anexo A — Bugs encontrados y su estado
13. Anexo B — Diagramas de flujo detallados
14. Anexo C — Matriz de permisos y estados

---

## 1. Introducción

Este Functional Design Document (FDD) documenta el diseño funcional de SCENCE tal como existe hoy en producción, verificado mediante auditoría en vivo (sesiones reales en los 3 portales, sin modificar datos) el 2026-07-01. No es una propuesta — es un registro fiel del sistema real, sus reglas de negocio, sus bugs conocidos y las decisiones de producto pendientes.

### 1.1 Resumen del producto

SCENCE es una plataforma SaaS B2B de gestión de campañas de influencer marketing. Permite a agencias de marketing y marcas gestionar el ciclo completo de una campaña: búsqueda y contratación de influencers, aprobación de contenido, facturación y pago.

| | |
|---|---|
| **Producto** | Plataforma multi-portal (Admin, Marca, Influencer) |
| **URL producción** | https://scence-app.vercel.app |
| **Stack** | Next.js 14 (App Router), Supabase (Postgres + Auth + RLS), Vercel |
| **Moneda base** | CLP (Peso chileno) |
| **Base de datos** | Supabase project `xzzbishzfyovrladcaeb`, Postgres 17 |

### 1.2 Objetivos

1. **Centralizar** la gestión de campañas de influencer marketing en un solo sistema.
2. **Automatizar** el flujo de trabajo: invitación → aceptación → entregables → aprobación → pago.
3. **Self-service** para marcas: crear campañas y contratar influencers sin intermediación obligatoria.
4. **Transparencia** para influencers: ver campañas, entregar contenido y ver pagos.
5. **Control** para el admin de SCENCE: visibilidad total, capacidad de intervención sin ser cuello de botella.
6. **Escalabilidad** SaaS: múltiples organizaciones/clientes sobre la misma base de código.

### 1.3 Impacto de arquitectura legacy

El producto migró sus rutas de un esquema sin prefijo (`/campaigns`, `/brand/campaigns`, `/dashboard`) a prefijos por portal (`admin-*`, `brand-*`, `inf-*`). Las rutas viejas siguen existiendo únicamente como alias de redirect en `src/middleware.ts` por seguridad — no son UI activa. Varios de los bugs encontrados en esta auditoría (ver Anexo A) son residuos de esa migración: links en el frontend que quedaron apuntando a la ruta legacy en vez de la nueva.

---

## 2. Requisitos de Negocio

La siguiente tabla resume las reglas de negocio activas del sistema — el equivalente a los "requisitos" de un proyecto de configuración, pero registrados aquí como reglas ya implementadas y verificadas contra el código real.

| ID | Regla | Descripción |
|---|---|---|
| BR-01 | Multi-tenancy | Todo dato está scoped por `organization_id`, reforzado en cada query server-side. |
| BR-02 | Roles de usuario | `super_admin`/`agency_manager` → Admin; `is_brand=true` → Marca; `is_influencer=true` → Influencer. `src/middleware.ts` enforza el routing por rol vía listas `ADMIN_ONLY`/`BRAND_ONLY`/`INFLUENCER_ONLY`. |
| BR-03 | Campañas private vs. open | `private`: la marca agrega influencers por invitación. `open`: los influencers postulan y la marca decide. |
| BR-04 | Auto-creación de deliverables | Al aceptar invitación/postulación se crean automáticamente los `campaign_deliverables` desde `deliverables_spec`; la campaña pasa a `active`. |
| BR-05 | `deliverables_spec` inmutable | Una vez creada la invitación, no se modifica — es el "contrato informal". Los `campaign_deliverables` son la fuente de verdad operacional. |
| BR-06 | Visibilidad entre portales | La marca no ve: email/teléfono de influencers, tarifas históricas con otras marcas, campañas de otras marcas, base completa de influencers, notas internas, payroll interno. El influencer no ve: tarifas de otros influencers ni datos financieros de campaña. |
| BR-07 | Status de campaña | Pasa a `active` con el primer influencer aceptado. No se puede invitar sobre campañas `completed`/`canceled`. |
| BR-08 | IVA en facturación | Todas las facturas incluyen IVA 19% (Chile): `tax_amount = subtotal * 0.19`. |
| BR-09 | Moneda CLP | Moneda por defecto en toda la UI (el schema soporta otras vía `currency_code`). |
| BR-10 | Brand self-registration | `/register/brand` auto-crea `brands` vinculado a la organización SCENCE. Primer login dispara `POST /api/brand/register`. |
| BR-11 | Middleware como última línea de defensa | El middleware bloquea correctamente el acceso cruzado entre portales incluso cuando el frontend expone un link/botón indebido (caso bug B-08) — pero eso no exime de limpiar la UI. |

### 2.1 Mapa de Proceso

![Mapa de Proceso SCENCE](mockups/process-map-master.png)

El flujo macro del negocio: se define la campaña, se convoca al elenco de influencers (por invitación directa o postulación abierta), se produce y aprueba el contenido (con retro-alimentación si se rechaza), y se cierra el ciclo con facturación y pago — cuyo cierre alimenta la siguiente campaña.

### 2.2 Flujo de Sistema (arquitectura)

```
Usuario ──▶ Next.js 14 (App Router, Vercel)
              │
              ├─ middleware.ts → enforza rol (admin-*/brand-*/inf-*)
              │
              ├─ Supabase Auth → sesión + user_metadata (is_brand, is_influencer)
              │
              └─ Supabase Postgres (RLS + admin client server-side)
                    │
                    ├─ campaigns, campaign_influencers, campaign_deliverables
                    ├─ influencers, influencer_social_profiles, brands
                    ├─ invoices, payroll_runs, bookings, contract_templates
                    ├─ affiliate_links, support_tickets, locations, organizations
                    │
      Integraciones externas:
        Google Calendar (Service Account) — bookings
        Apify — sync de métricas de Instagram
        Resend — emails transaccionales
        Stripe — scaffold presente, checkout no activo
```

### 2.3 Supuestos

1. El equipo de SCENCE (Admin) actúa como agencia intermediaria y como operador de la plataforma a la vez.
2. Las marcas se auto-registran y operan en modo self-service; el Admin puede intervenir en cualquier campaña.
3. Los influencers son gestionados centralmente por el roster de SCENCE (Admin), no por cada marca individualmente.
4. La moneda de referencia para toda la operación comercial es CLP.
5. El middleware de Next.js es la capa de control de acceso entre portales; el frontend debe reflejar esas restricciones en la UI, no reemplazarlas.

### 2.4 Restricciones

- Sin app móvil nativa.
- Cobro a marcas vía Stripe: scaffold de datos listo, sin UI de checkout activa.
- Sin firma electrónica de contratos (DocuSign).
- Sin tracking de performance post-publicación en tiempo real (views/likes).
- Sin marketplace público de influencers.
- Configuración → Usuarios (gestión de equipo real) y Billing/Marcas colaboradoras de Marca: pendientes de decisión de producto (ver Anexo A y §7 Datos e Importación).

---
## 3. Requisitos Funcionales por Portal

> Los mockups son reconstrucciones fieles (SVG, no screenshots literales) generadas a partir de la sesión en vivo del 2026-07-01, en `docs/mockups/*.svg`.

### 3.1 Portal Admin

Acceso: `role: super_admin | agency_manager`. Rutas: `admin-*`. Equipo interno de SCENCE — acceso total a todos los datos de la plataforma.

#### AD-01 Dashboard
![Dashboard Admin](mockups/admin-dashboard.svg)

**Navegación:** `admin-dash` · **API:** `GET /api/dashboard` · **Tablas:** `campaigns`, `influencers`, `brands`, `invoices`, `payroll_runs`, `campaign_deliverables`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Campañas en curso | `count(campaigns) where status in (active,pending_influencers)` | KPI de carga operativa del mes |
| Influencers en roster | `count(influencers) where is_active=true` | Tamaño total del roster disponible |
| Marcas registradas | `count(brands)` | Tamaño de la cartera de clientes |
| Facturado (outbound) | `sum(invoices.total)` del mes | Ingreso reconocido |
| Costos recibidos | `sum(payroll_runs.total)` del mes | Costo de payroll del mes |
| Margen bruto | `facturado - costos` | Rentabilidad rápida |
| Live influencers | Placeholder (siempre 0 hoy) | Feature futura de "conectados ahora" |

**Regla:** todo se filtra por `organization_id` del usuario.

#### AD-02 Lista de Campañas
![Lista Campañas Admin](mockups/admin-campaigns-list.svg)

**Navegación:** `admin-campaigns` · **API:** `GET /api/campaigns` · **Tablas:** `campaigns`, `brands`, `campaign_influencers`, `campaign_deliverables`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| KPIs (activas, budget total, gastado, deliverables pend.) | Agregados server-side | Cabecera de control |
| Campaña / Tipo / Influencers / Progreso / Budget / Fechas / Estado | `campaigns.*` join `campaign_influencers`, `campaign_deliverables` | Fila de tabla completa |
| Filtros (tipo, plataforma, fecha, estado) | Query params sobre `/api/campaigns` | Búsqueda server-side |

**Acciones:** Nueva campaña, Crear con IA (AI Campaign Builder vía Claude Haiku), abrir detalle, filtrar.

#### AD-03 Nueva Campaña (wizard 4 pasos)
![Nueva Campaña](mockups/admin-campaign-new.svg)

**Navegación:** `admin-campaigns/new` — mismo componente `CampaignForm.tsx` que usa Marca (`brand-campaigns/new`), API distinta por portal.

| Campo | Paso | Para qué sirve |
|---|---|---|
| Nombre * | 1 Información | Identificador visible |
| Descripción | 1 | Brief interno |
| Tipo * | 1 | Sponsored Post / Embajador / UGC / Evento / Product Seeding / Live |
| Visibilidad * | 1 | `private` (invitación) vs `open` (postulación) — BR-03 |
| Fechas inicio/fin | 2 Budget | Ventana de ejecución |
| Budget + Moneda | 2 | Techo de gasto (CLP) |
| Comisión % | 2 | Margen de agencia sobre budget |
| Plataformas / Hashtags / Menciones | 3 Contenido | Specs de publicación |
| Guía de contenido | 3 | Tono/estilo para el influencer |
| Deliverables (tags) | 3 | Plantilla de entregables sugeridos |
| Resumen | 4 Confirmar | Revisión antes de crear (`status=draft`) |

#### AD-04 Detalle de Campaña
![Detalle Campaña Admin](mockups/admin-campaign-detail.svg)

**Navegación:** `admin-campaigns/[id]` · **Tabs:** Overview · Influencers · Deliverables · Assets · Lugares · Facturas · Historial

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Header (nombre, estado, tipo, fechas, visibilidad) | `campaigns.*` | Identificación rápida |
| % Completado / % Budget usado | Derivado de `campaign_deliverables`, `budget_total` | Salud de campaña |
| Tab Influencers | `campaign_influencers` join `influencers` | Gestión de elenco |
| Tab Deliverables | `campaign_deliverables` | Aprobar/rechazar contenido |
| Tab Facturas | `invoices` filtradas por `campaign_id` | Trazabilidad financiera |
| Tab Historial | Audit log de cambios de estado | Trazabilidad de decisiones |

**Reusado por Marca:** `brand-campaigns/[id]` reutiliza este mismo componente (`CampaignDetail`), filtrado por permisos — ver 3.2.

#### AD-05 Lista de Influencers
![Lista Influencers Admin](mockups/admin-influencers-list.svg)

**Navegación:** `admin-influencers` (1.450 registros) · **Tablas:** `influencers`, `influencer_social_profiles`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Nombre / avatar | `influencers.display_name, avatar_url` | Identificación |
| Plataformas / seguidores / engagement | `influencer_social_profiles` | Evaluación de fit |
| Rating | `influencers.rating` (histórico de campañas) | Calidad de colaboración |
| Email / teléfono | `influencers.email, phone` | Contacto directo (solo Admin — BR-06) |
| Tarifas históricas | `influencer_rate_cards` | Referencia de negociación (solo Admin — BR-06) |

**Estado:** ✅ corregido en v2.1 — bug B-01 (link roto a `/influencers/[id]`) resuelto, ver Anexo A.

#### AD-06 Perfil de Influencer
**Navegación:** `admin-influencers/[id]` · **Tabla:** `influencers`

Ficha completa: datos de contacto, redes sociales, historial de campañas, tarifas, notas internas (solo visibles para Admin).

#### AD-07 Data Quality
![Data Quality](mockups/admin-influencers-data-quality.svg)

**Navegación:** `admin-influencers/data-quality` · **API:** `GET /api/influencers/duplicates`, `POST /api/influencers/merge`, `DELETE /api/influencers/bulk-delete`, `POST /api/influencers/sync-instagram`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Total / Activos-Inactivos / Sin Instagram | Agregados sobre `influencers` | Salud de la base |
| Duplicados por email / IG URL / IG @ | Detección server-side por coincidencia exacta | Limpieza antes de importar |
| Sincronizar Instagram | Llama Apify actor | Métricas frescas |

#### AD-08 Ranking de Influencers
![Ranking Admin](mockups/admin-influencers-ranking.svg)

**Navegación:** `admin-influencers/ranking`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Seguidores / Engagement / Rating | `influencer_social_profiles`, `influencers.rating` | Ordenar por criterio de negocio |
| Campañas / Entregables / Cumplimiento | `campaign_influencers`, `campaign_deliverables` | Desempeño histórico real |

#### AD-09 Lista y Detalle de Marcas
![Lista Marcas](mockups/admin-brands-list.svg) ![Detalle Marca](mockups/admin-brand-detail.svg)

**Navegación:** `admin-brands`, `admin-brands/[id]` · **Tabs:** Overview · Campañas · Influencers · Lugares · Billing · Acceso · Historial

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Estado (Aprobada/Pendiente/Suspendida) | `brands.status` | Control de acceso al portal marca |
| Industria / Contacto / Email | `brands.*` | Ficha comercial |
| Campañas activas / totales | `campaigns where brand_id` | Volumen de negocio |
| Tab Acceso | `auth.users` vinculados | Invitar/gestionar acceso |
| Aprobar / Suspender | `PATCH brands.status` | Gate de acceso al portal marca |

#### AD-10 Bookings
![Bookings](mockups/admin-bookings.svg)

**Navegación:** `admin-bookings` · **API:** `lib/google-calendar.ts` (Service Account) · **Tabla:** `bookings`

Vista mensual/lista sincronizada con Google Calendar. Agenda operativa de apariciones/eventos.

#### AD-11 Billing (Facturas + Payroll)
![Billing](mockups/admin-billing.svg)

**Navegación:** `admin-billing` (tabs Facturas/Payroll; `admin-payroll` redirige aquí) · **Tablas:** `invoices`, `payroll_runs`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Total facturado / cobrado / vencido | Agregados sobre `invoices` | Salud de cobranza |
| Payroll total | `sum(payroll_runs)` | Costo total a influencers |
| Tabla Facturas | `invoices.*` join `brands`, `campaigns` | Gestión de cobranza (IVA 19% — BR-08) |

#### AD-12 Contratos
![Contratos](mockups/admin-contracts.svg)

**Navegación:** `admin-contracts` · **Tabla:** `contract_templates` (variables `{{primary_brand_name}}`, `{{campaign_name}}`, etc.)

Plantillas de contrato reutilizables por tipo de campaña, con variables dinámicas.

#### AD-13 Afiliados
![Afiliados](mockups/admin-affiliates.svg)

**Navegación:** `admin-affiliates` · **API:** `/api/affiliates`, `/api/track/[code]` · **Tabla:** `affiliate_links`

Links activos, clicks, conversiones y revenue por link de afiliado.

#### AD-14 Eventos & Entradas
![Eventos](mockups/admin-events.svg)

**Navegación:** `admin-events`, `admin-events/[id]` · **API:** `/api/events`, `/api/events/[id]/tickets`, `/api/events/[id]/sales`

Módulo de venta de entradas para activaciones tipo evento: total eventos, entradas vendidas, revenue, próximos.

#### AD-15 Analytics
![Analytics](mockups/admin-analytics.svg)

**Navegación:** `admin-analytics` · **Tablas:** `invoices`, `payroll_runs`, `campaigns`, `campaign_deliverables`

Vista financiera ejecutiva: revenue total, margen promedio, budget utilizado, tasa de completion, por periodo (1/3/6/12 meses).

#### AD-16 Soporte
![Soporte Admin](mockups/admin-support.svg)

**Navegación:** `admin-support` (todos los tickets de la organización) · **Tabla:** `support_tickets`

Triage por prioridad (P1-P3), estado (Abierto/En progreso/Cerrado), remitente y rol.

#### AD-17 Configuración
![Configuración Admin](mockups/admin-settings.svg)

**Navegación:** `admin-settings/*` · **Tabla:** `organizations`

| Tab | Fuente | Estado |
|---|---|---|
| Mi perfil | `profiles.*` | ✅ OK |
| Organización | `organizations.*` | ✅ OK |
| Usuarios | — | 🔜 marcado "soon" en v2.1 (antes alias engañoso — bug B-02, ver Anexo A) |
| Lugares | `locations` (tabla existe) | ⚠️ stub sin funcionalidad — G-13 |

---
### 3.2 Portal Marca

Acceso: `user_metadata.is_brand = true`. Rutas: `brand-*`. Cliente B2B — gestiona sus propias campañas y contrata influencers del catálogo SCENCE.

**Regla clave de producto:** el portal Marca reutiliza la experiencia Admin filtrada por permisos (no vistas paralelas reducidas). La Marca solo ve: sus campañas, influencers relacionados a sus campañas, marcas colaboradoras relacionadas (solo el nombre). La Marca NO ve: base completa de influencers SCENCE, notas internas, payroll interno, datos privados/direcciones, datos comerciales sensibles de otras marcas (BR-06).

#### MK-01 Dashboard
![Dashboard Marca](mockups/brand-dashboard.svg)

**Navegación:** `brand-dash` · **API:** `GET /api/brand/campaigns` · **Tablas:** `brands`, `campaigns`, `campaign_influencers`, `campaign_deliverables`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Campañas activas / Influencers / Para revisar | Agregados filtrados por `brand_id` | Vista rápida operativa |
| Lista "Tus campañas" | `campaigns where brand_id = brand.id` | Acceso directo a cada campaña propia |

**Regla:** solo ve campañas donde `campaigns.brand_id = brand.id` (BR-06).

#### MK-02 Lista de Campañas
![Lista Campañas Marca](mockups/brand-campaigns-list.svg)

**Navegación:** `brand-campaigns` · **API:** `GET /api/brand/campaigns` — lista real con los mismos filtros que Admin (búsqueda, tipo, plataforma, fecha, estado), reutilizando `CampaignsClient.tsx`.

**Estado:** ✅ corregido en v2.1 — KPI "Total gastado" mostraba `$NaN` sin datos; ahora `$0` (fix aplicado, ver Anexo A).

#### MK-03 Nueva Campaña
Mismo wizard 4 pasos que AD-03 (`CampaignForm.tsx` compartido). **Regla:** `brand_id` y `created_by_brand_id` = brand.id del usuario logueado (BR-10).

#### MK-04 Detalle de Campaña
Mismo componente que AD-04 (`CampaignDetail`), reutilizado vía `brand-campaigns/[id]` — solo si `brand_id` = la propia. Acciones de edición solo si la marca es creadora. Datos de marcas colaboradoras (si las hubiera) se muestran solo por nombre.

#### MK-05 Invitar Influencer
![Invitar Influencer](mockups/brand-invite-influencer.svg)

**Navegación:** `brand-campaigns/[id]/invite` · **API:** `POST /api/brand/campaigns/[id]/invite` · **Tabla:** `campaign_influencers`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Influencer seleccionado | Viene del catálogo (`?influencerId=`) | Define a quién se invita |
| Tarifa propuesta (CLP) | Input libre, opcional | Si vacío, se negocia directo |
| Mensaje | Input libre | Contexto/objetivo para el influencer |
| Deliverables (tipo, cantidad, fecha) | `deliverables_spec` (inmutable, BR-05) | Genera los `campaign_deliverables` reales al aceptar |

**Estado:** ✅ corregido en v2.1 — el submit apuntaba a un endpoint inexistente (`/api/brand-campaigns/...` en vez de `/api/brand/campaigns/...`), mismo root-cause que B-07. Ver Anexo A.

#### MK-06 Postulaciones / Invitaciones
**Navegación:** `brand-campaigns/[id]/applications` · **API:** `GET/PATCH /api/brand/campaigns/[id]/applications`

Lista de postulaciones (campañas open) e invitaciones enviadas, con acciones Aceptar/Rechazar.

**Estado:** ✅ corregido en v2.1 — bug B-07, mismo root-cause que MK-05 (URL de fetch no coincidía con la ruta real de la API). Ver Anexo A.

#### MK-07 Catálogo de Influencers
![Catálogo Marca](mockups/brand-influencers-catalog.svg)

**Navegación:** `brand-influencers` — catálogo filtrado a los influencers relacionados con sus campañas (no el roster completo de 1.450, por BR-06).

| Campo | Visible para Marca |
|---|---|
| Nombre / avatar / plataformas / seguidores / engagement / rating | ✅ |
| Email / teléfono / tarifas históricas con otras marcas | ❌ (BR-06) |
| Botón "Data Quality" | ❌ (ocultado en v2.1 — bug B-08, ver Anexo A) |
| Nombre del influencer clickable a ficha admin | ❌ (ocultado en v2.1 — bug B-01, no hay ficha propia de marca aún — gap G-09) |

#### MK-08 Ranking de Influencers
**Navegación:** `brand-influencers/ranking` — solo relacionados a sus campañas.

#### MK-09 Perfil de Marca
![Perfil Marca](mockups/brand-profile.svg)

**Navegación:** `brand-profile` · **Tabla:** `brands`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Nombre empresa / RUT / Industria | `brands.name, tax_id, industry` | Ficha comercial editable por la propia marca |
| Sitio web / Instagram | `brands.website, instagram_handle` | Presencia digital |
| Dirección principal | `brands.address_*` | Facturación/logística — privado, no visible a otras marcas |

#### MK-10 Configuración
**Navegación:** `brand-settings/*` — mismo patrón que Admin (Mi perfil, Organización, Usuarios 🔜, Lugares).

#### MK-11 Soporte
**Navegación:** `brand-support` — solo tickets propios.

#### MK-12 Billing (Marca) — 🔜 pendiente
**Navegación:** `brand-billing` — marcado "soon" en v2.1 (antes 404 real — bug B-04). Requiere decisión de producto: qué facturas/datos financieros mostrar antes de construir la vista real.

#### MK-13 Marcas colaboradoras — 🔜 pendiente
**Navegación:** `brand-brands` — marcado "soon" en v2.1 (antes 404 real — bug B-05). Requiere decisión de producto: alcance de "solo nombre" de otras marcas por campaña compartida (BR-06).

---

### 3.3 Portal Influencer

Acceso: `user_metadata.is_influencer = true`. Rutas: `inf-*`. Creador de contenido — ve invitaciones/campañas, sube contenido, ve historial de pagos.

#### IN-01 Dashboard
![Dashboard Influencer](mockups/inf-dashboard.svg)

**Navegación:** `inf-dash` · **API:** `GET /api/influencer/campaigns`, `GET /api/influencer/tasks` · **Tablas:** `campaign_influencers`, `campaign_deliverables`, `bookings`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Tareas pendientes / Campañas activas | Agregados sobre `campaign_deliverables`, `campaign_influencers` | Carga de trabajo |
| Por cobrar / Cobrado | `payroll_runs` filtrado por influencer | Transparencia de pagos |
| Avance de campañas | `deliverables aprobados / total` | Seguimiento de cumplimiento |

#### IN-02 Entregables (Mis Tareas)
![Entregables](mockups/inf-tasks.svg)

**Navegación:** `inf-tasks` · **API:** `GET /api/influencer/tasks`, `PATCH /api/influencer/tasks/[id]`, `POST /api/influencer/deliverables/[id]/submit` · **Tabla:** `campaign_deliverables`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Campaña / tipo de entregable | `campaign_deliverables.campaign_id, type` | Contexto de la entrega |
| Estado (Pendiente/En revisión/Aprobado/Rechazado) | `campaign_deliverables.status` | Ciclo de vida (ver §5) |
| Subir | Form de URL + notas | Único punto de entrega de contenido |

**Regla:** el influencer solo ve sus propios deliverables (`WHERE influencer_id = auth.uid()`).

**Estado:** ✅ corregido en v2.1 — link a detalle de campaña apuntaba a ruta legacy (bug B-09, ver Anexo A).

#### IN-03 Campañas
![Campañas Influencer](mockups/inf-campaigns.svg)

**Navegación:** `inf-campaigns` · **API:** `GET /api/influencer/campaigns`, `GET /api/influencer/my-campaigns`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Asignadas por agencia | `campaign_influencers` donde `application_status=accepted` | Campañas reales de SCENCE/marca |
| "Campañas propias" (botón Nueva campaña) | Tabla propia, sin marca asociada | Posible tracking personal — **G-11, requiere decisión de producto** |

**Estado:** ✅ corregido en v2.1 — 2 links a detalle apuntaban a ruta legacy (bug B-09, ver Anexo A).

#### IN-04 Detalle de Campaña
**Navegación:** `inf-campaign/[id]` — reutiliza `CampaignDetailView.tsx` (mismo componente base, no el `CampaignDetail` de Admin).

#### IN-05 Bookings
![Bookings Influencer](mockups/inf-bookings.svg)

**Navegación:** `inf-bookings` · **Tabla:** `bookings`

**Estado:** ✅ corregido en v2.1 — bug B-06. La query pedía un join directo `bookings → brands` que no existe en el schema real (`bookings` no tiene FK a `brands`); la relación correcta es `bookings.campaign_id → campaigns.brand_id → brands.id`. Corregido anidando `brand` dentro de `campaign` en el select y aplanándolo de vuelta en la respuesta. Ver Anexo A.

#### IN-06 Perfil
![Perfil Influencer](mockups/inf-profile.svg)

**Navegación:** `inf-profile` · **Tabla:** `influencers`

| Campo | Fuente | Para qué sirve |
|---|---|---|
| Nombre, email, teléfono, dirección | `influencers.*` | Contacto — solo visible para el propio influencer y Admin (BR-06) |
| Categorías (tags) | `influencers.categories` | Filtros del catálogo de marca |
| Redes sociales | `influencer_social_profiles` | Base del ranking y tarifas sugeridas |

#### IN-07 Soporte
**Navegación:** `inf-support` — solo tickets propios.

---
## 4. Reportes

Los siguientes reportes/vistas agregadas existen hoy en producción. A diferencia de un reporting engine dedicado, en SCENCE cada uno vive embebido en su módulo (no hay un "Report Manager" separado).

### REP-01 Reporte PDF de Campaña

| | |
|---|---|
| **Propósito** | Resumen ejecutivo exportable de una campaña: elenco, deliverables, budget, timeline. |
| **Frecuencia de uso** | Bajo demanda, al cierre o para presentar a stakeholders. |
| **Navegación** | `admin-campaigns/[id]/report` (Admin) · `brand-campaigns/[id]/report` (Marca) |
| **Campos** | Nombre de campaña, marca, fechas, budget total/gastado, influencers participantes, deliverables por estado. |

### REP-02 Analytics Ejecutivo

| | |
|---|---|
| **Propósito** | Vista financiera de alto nivel: revenue, margen, budget utilizado, tasa de completion. |
| **Frecuencia de uso** | Mensual/trimestral. |
| **Navegación** | `admin-analytics` |
| **Campos** | Revenue total, margen promedio, % budget utilizado, tasa de completion, serie Revenue vs. Payroll por periodo (1/3/6/12 meses). |

### REP-03 Ranking de Influencers

| | |
|---|---|
| **Propósito** | Ordenar el roster (o el catálogo filtrado de una marca) por desempeño real, no solo por métricas de redes. |
| **Frecuencia de uso** | Continuo, al elegir influencers para una nueva campaña. |
| **Navegación** | `admin-influencers/ranking` · `brand-influencers/ranking` |
| **Campos** | Seguidores, engagement, rating, campañas realizadas, entregables, % de cumplimiento. |

### REP-04 Data Quality del Roster

| | |
|---|---|
| **Propósito** | Detectar duplicados e inconsistencias antes de escalar la base de influencers. |
| **Frecuencia de uso** | Mensual o antes de una importación masiva. |
| **Navegación** | `admin-influencers/data-quality` |
| **Campos** | Total influencers, activos/inactivos, sin Instagram, duplicados por email/URL/@ de Instagram. |

### REP-05 Billing (Facturas + Payroll)

| | |
|---|---|
| **Propósito** | Salud de cobranza (facturas a marcas) y costo total de payroll a influencers. |
| **Frecuencia de uso** | Continuo/semanal. |
| **Navegación** | `admin-billing` |
| **Campos** | Total facturado, cobrado, vencido; total payroll; detalle por factura (cliente, campaña, monto, IVA, estado). |

---

## 5. Convenciones de Estado y Color (Theming)

SCENCE no usa temas visuales sobre planos (no aplica, a diferencia de un sistema de gestión de espacios físicos) — el equivalente funcional es la convención de color/badge por estado de cada entidad, consistente en toda la UI:

| Entidad | Estado | Color/Badge |
|---|---|---|
| Campaña | `active` | Verde |
| Campaña | `draft` | Gris |
| Campaña | `completed` | Violeta |
| Campaña | `canceled` | Rojo |
| Campaña | `paused` | Ámbar |
| Postulación/Invitación | `pending` | Ámbar |
| Postulación/Invitación | `accepted` | Verde |
| Postulación/Invitación | `rejected` | Rojo |
| Postulación/Invitación | `expired` / `withdrawn` | Gris |
| Deliverable | `pending` | Gris |
| Deliverable | `in_review` | Ámbar |
| Deliverable | `approved` / `published` | Verde |
| Deliverable | `rejected` | Rojo |
| Factura | `paid` | Verde |
| Factura | `overdue` | Rojo |
| Factura | `sent` | Ámbar |
| Factura | `draft`/`void` | Gris |

---

## 6. Requisitos de Integración

| ID | Integración | Descripción | Dirección |
|---|---|---|---|
| INT-01 | Google Calendar (Service Account) | Sincroniza `bookings` con eventos de calendario para la agenda operativa de Admin. | Entrada/Salida |
| INT-02 | Apify (Instagram Sync) | Actualiza followers/engagement de `influencer_social_profiles` bajo demanda desde Data Quality. | Entrada |
| INT-03 | Resend | Envío de emails transaccionales (ver §9). | Salida |
| INT-04 | Stripe | Scaffold de columnas y modelo de datos presente (migración `stripe_resend_columns`), sin UI de checkout activa. | — (no activo) |
| INT-05 | Supabase Auth | Autenticación y sesión; `user_metadata` determina el portal (`is_brand`, `is_influencer`). | Entrada/Salida |

---

## 7. Datos e Importación Masiva

A diferencia de un proyecto de migración de sistema legacy, SCENCE no migra datos de un sistema anterior — pero sí tiene un flujo real de carga masiva de datos que documentar:

**Nombre:** Importación masiva de influencers (CU-04)
**Resumen:** Carga de influencers al roster vía archivo CSV.
**Navegación:** `admin-influencers` → Bulk Upload
**API:** `POST /api/influencers/bulk`
**Volumen:** hasta 1.500 influencers por lote.
**Reglas de negocio:** los registros se crean con `status=draft`; requiere revisión posterior en Data Quality (REP-04) antes de activarse en el roster operativo.

**Nombre:** Importación de ocupación/asignación (equivalente al patrón "Occupancy List Import" de proyectos de gestión de espacio)
**Estado:** no implementado en SCENCE — no aplica, el modelo de asignación es por invitación/postulación (BR-03), no por importación batch.

---

## 8. Requisitos No-Funcionales

### NFR-01 Auditoría / Trazabilidad
El detalle de campaña incluye un tab "Historial" con audit log de cambios de estado (ver AD-04). **No confirmado en esta auditoría:** si existe una tabla de audit trail genérica a nivel de plataforma (cambios en `influencers`, `brands`, etc.) — queda como pendiente de verificación, no como hallazgo negativo.

### NFR-02 Infraestructura
Hosting en Vercel (frontend/API routes) + Supabase Cloud (Postgres, Auth, Storage). Sin infraestructura propia que mantener.

### NFR-03 Rendimiento
No hay SLA de performance formalizado ni monitoreo de latencia documentado en esta auditoría.

### NFR-04 Backup y Recuperación
Backups gestionados por Supabase (point-in-time recovery según plan contratado). No verificado el plan/retención exacta en esta auditoría.

### NFR-05 Seguridad multi-portal
El middleware (`src/middleware.ts`) es la capa de control de acceso entre los 3 portales (BR-02, BR-11). Confirmado por auditoría que bloquea correctamente accesos cruzados incluso cuando la UI expone un botón indebido (bug B-08).

### NFR-06 Licenciamiento
Stack basado en servicios de suscripción: Vercel, Supabase, Apify, Resend, Anthropic (AI Campaign Builder). Sin licencias perpetuas que gestionar.

### NFR-07 Otro
N/A.

---

## 9. Notificaciones por Email

Sistema de emails transaccionales vía Resend (`src/lib/resend.ts`). Plantillas confirmadas en el código:

**EMAIL-01 — Invitación a campaña** (`influencerInviteEmail`)
Asunto implícito: invitación de marca a campaña. Incluye nombre del influencer, marca, campaña, mensaje opcional y link a la invitación.
**Estado:** ⚠️ la función existe pero no se encontró ningún punto del código que la invoque — **no se está enviando en producción hoy** (relacionado con gap G-08, "email de invitación no se envía automático").

**EMAIL-02 — Confirmación de booking** (`bookingConfirmEmail` en `resend.ts`)
**Estado:** ⚠️ misma situación — no invocada. Existe una plantilla distinta y sí activa (`bookingConfirmationEmail`, inline) en `src/app/api/bookings/send-confirmations/route.ts`, con botones de confirmar/rechazar. Duplicación a resolver: dos plantillas de booking, solo una en uso.

**EMAIL-03 — Estado de deliverable** (`deliverableStatusEmail`)
**Estado:** ✅ activa, invocada desde `src/app/api/emails/deliverable-status/route.ts`. Notifica al influencer cuando su entrega es aprobada o rechazada, con notas de revisión si aplica.

**EMAIL-04 — Factura** (`invoiceEmail`)
**Estado:** ✅ activa, invocada desde `src/app/api/invoices/[id]/route.ts`. Notifica a la marca el detalle de una factura (cliente, total, vencimiento).

---

## 10. Documentos de Apoyo

| Documento | Descripción | Ubicación |
|---|---|---|
| Este FDD (fuente) | Versión Markdown, control de versiones | `docs/FUNCTIONAL_DESIGN.md` (repo) |
| Este FDD (Word) | Copia editable/imprimible | Carpeta del proyecto |
| Mockups de pantallas | 29 SVG reconstruidos de la auditoría en vivo | `docs/mockups/*.svg` |
| Migraciones de base de datos | Definición real de tablas (con drift conocido — ver nota) | `supabase/migrations/*.sql` |
| Middleware de rutas | Enforcement de roles por portal | `src/middleware.ts` |

**Nota de integridad:** durante esta auditoría se confirmó que las migraciones en el repo **no reflejan el 100% del schema real** de producción (ej. la tabla `brands` no tiene migración de creación en el repo, pero existe y está en uso — fue creada fuera del flujo de migraciones versionadas). Se recomienda una tarea futura de reconciliación schema-real vs. migraciones.

---

## 11. Glosario

| Término | Definición |
|---|---|
| BR | Business Rule — regla de negocio (§2) |
| RLS | Row Level Security — políticas de acceso a nivel de fila en Postgres/Supabase |
| Deliverable | Entregable de contenido asociado a una campaña e influencer |
| Booking | Reserva/evento agendado con un influencer (aparición, shoot, evento) |
| Payroll run | Corrida de pago agrupada a uno o más influencers |
| CLP | Peso chileno — moneda base de la plataforma |
| IVA | Impuesto al Valor Agregado (19% en Chile) — BR-08 |
| `is_brand` / `is_influencer` | Flags en `user_metadata` de Supabase Auth que determinan el portal del usuario |
| `organization_id` | Identificador de tenant — todo dato queda scoped a una organización (BR-01) |
| `application_status` | Estado del ciclo invitación/postulación (`pending`, `accepted`, `rejected`, etc.) |
| Campaña `private` vs `open` | Visibilidad de campaña: por invitación directa vs. postulación abierta (BR-03) |
| Portal | Uno de los 3 frontends de la app: Admin, Marca, Influencer |

---
## 12. Anexo A — Bugs encontrados y su estado

Se encontraron 9 bugs de producción en la auditoría en vivo del 2026-07-01. **6 fueron corregidos** con commits pequeños e independientes (sin push a producción, pendiente de aprobación de deploy). 4 quedaron marcados "🔜 soon" en vez de construir la feature completa, por requerir decisión de producto sobre qué datos mostrar (relacionado a BR-06).

| ID | Severidad | Portal | Descripción | Estado v2.1 |
|---|---|---|---|---|
| B-01 | 🔴 Crítica | Admin/Marca | Clic en influencer del roster → 404 (`/influencers/[id]` no existe) | ✅ Corregido — link real a `/admin-influencers/[id]`; en Marca, no clickable (sin ficha propia aún) |
| B-02 | 🟡 Media | Admin | Configuración → Usuarios mostraba el formulario de Organización (alias engañoso) | ✅ Mitigado — tab marcado "soon", ya no navegable. Construir gestión real de usuarios queda pendiente de decisión de producto |
| B-03 | 🟡 Media | Marca | Mismo bug que B-02 | ✅ Mitigado — mismo tratamiento |
| B-04 | 🔴 Alta | Marca | `brand-billing` → 404 | ✅ Mitigado — nav marcado "soon" en vez de 404. Construir la vista real queda pendiente de decisión de producto (qué facturas mostrar) |
| B-05 | 🔴 Alta | Marca | `brand-brands` → 404 | ✅ Mitigado — mismo tratamiento. Requiere definir alcance de "solo nombre" de marcas colaboradoras (BR-06) |
| B-06 | 🟡 Media | Influencer | Error crudo de Supabase: *"Could not find a relationship between 'bookings' and 'brands'"* | ✅ Corregido — join reescrito vía `bookings.campaign_id → campaigns.brand_id → brands.id` |
| B-07 | 🟡 Media | Marca | Tab de postulaciones/invitaciones: `Unexpected token '<' ... is not valid JSON` | ✅ Corregido — el fetch apuntaba a `/api/brand-campaigns/...` en vez de `/api/brand/campaigns/...`. Se encontró y corrigió el mismo bug en el submit de "Invitar influencer" (no reportado antes) |
| B-08 | 🟢 Baja | Marca | Botón "Data Quality" visible, apunta a herramienta admin-only | ✅ Corregido — oculto para Marca |
| B-09 | 🔴 Alta | Influencer | Clic en campaña asignada → 404 (`/campaign/[id]` legacy) | ✅ Corregido — 4 ocurrencias actualizadas a `/inf-campaign/[id]` |
| — | 🟢 Muy baja | Marca | KPI "Total gastado" mostraba `$NaN` sin datos | ✅ Corregido — guard `?? 0` agregado |

**Limpieza adicional:** se eliminó `CampaignDetailView.brand.tsx`, componente con el mismo bug de URL que B-07 pero confirmado como código muerto (0 referencias en el repo) — la vista real de Marca reutiliza `CampaignDetail` de Admin, por diseño.

**Patrón común (B-01, B-04, B-05, B-09):** residuos de la migración de rutas a los prefijos `admin-*/brand-*/inf-*`.

---

## 13. Anexo B — Diagramas de flujo detallados

### B.1 Registro Marca (self-service)
```mermaid
flowchart TD
    A["Marca visita /register/brand"] --> B["Completa: empresa, contacto, email, password"]
    B --> C["signUp Supabase — is_brand=true, brand_name en metadata"]
    C --> D["Email de confirmación enviado"]
    D --> E["Click en link → /auth/callback"]
    E --> F["Redirect → /brand-dash"]
    F --> G{"Layout detecta is_brand=true"}
    G --> H["POST /api/brand/register"]
    H --> I[("brands: org_id = org SCENCE, user_id = auth.uid")]
    I --> J["Dashboard vacío — lista para crear primera campaña"]
```

### B.2 Creación de campaña
```mermaid
flowchart TD
    A["/brand-campaigns/new"] --> B["Wizard: Información → Budget → Contenido → Confirmar"]
    B --> C["POST /api/brand/campaigns"]
    C --> D[("campaigns: status=draft, brand_id, created_by_brand_id")]
    D --> E["Redirect → /brand-campaigns/[id]"]
    E --> F["Campaña en draft — lista para invitar influencers"]
```

### B.3 Invitación influencer (campaña private)
```mermaid
flowchart TD
    A["Marca → /brand-influencers"] --> B["Busca y filtra influencers"]
    B --> C["Click 'Invitar' → /brand-campaigns/[id]/invite?influencerId=..."]
    C --> D["GET /api/brand/influencers/[id]"]
    D --> E["Completa fee, mensaje, deliverables"]
    E --> F["POST /api/brand/campaigns/[id]/invite"]
    F --> G[("campaign_influencers: origin=invitation, application_status=pending")]
    G --> H{"Influencer responde"}
    H -->|Acepta| I["PATCH application_status=accepted"]
    H -->|Rechaza| J["application_status=rejected"]
    I --> K["Auto-crea campaign_deliverables desde deliverables_spec"]
    K --> L["campaign.status → active (si era draft)"]
```

### B.4 Postulación (campaña open)
```mermaid
flowchart TD
    A["Campaña visibility=open"] --> B["GET /api/influencer/campaigns/open"]
    B --> C["Influencer postula + mensaje"]
    C --> D["POST /api/influencer/campaigns/[id]/apply"]
    D --> E[("campaign_influencers: origin=application, status=pending")]
    E --> F["Marca ve en /brand-campaigns/[id]/applications"]
    F --> G{"Marca decide"}
    G -->|Acepta| H["Auto-crea deliverables + campaign.status=active"]
    G -->|Rechaza| I["application_status=rejected"]
```

### B.5 Entrega y aprobación de deliverables
```mermaid
flowchart TD
    A["Influencer ve /inf-tasks"] --> B["Sube URL de contenido + notas"]
    B --> C["POST /api/influencer/deliverables/[id]/submit"]
    C --> D["deliverable.status → in_review"]
    D --> E["Marca/Admin ve 'X para revisar' en dashboard"]
    E --> F["Revisa contenido (link externo)"]
    F --> G{"Decisión"}
    G -->|Aprueba| H["status → approved · EMAIL-03"]
    G -->|Rechaza| I["status → rejected + review_notes · EMAIL-03"]
    I --> B
```

### B.6 Facturación
```mermaid
flowchart TD
    A["Admin crea invoice en /admin-billing"] --> B["POST /api/invoices — IVA 19%"]
    B --> C[("invoices: status=draft")]
    C --> D["draft → sent → paid"]
    D --> E["Marca ve la factura · EMAIL-04"]
```

### B.7 Payroll
```mermaid
flowchart TD
    A["Admin crea payroll run en /admin-billing (tab Payroll)"] --> B["POST /api/payroll"]
    B --> C[("payroll_runs: agrupa pagos a influencers")]
    C --> D["pending → approved → processing → paid"]
    D --> E["Influencer ve su pago en /inf-dash"]
```

---

## 14. Anexo C — Matriz de permisos y estados

### C.1 Matriz de permisos por rol

| Recurso/Acción | super_admin | agency_manager | brand_manager (is_brand) | influencer (is_influencer) |
|---|---|---|---|---|
| Leer campaigns (todas) | ✅ | ✅ | ❌ (solo propias) | ❌ |
| Crear campaign | ✅ | ✅ | ✅ | ⚠️ ver G-11 |
| Editar campaign | ✅ | ✅ | ✅ (propia, pre-activa) | ❌ |
| Borrar campaign | ✅ | ✅ | ❌ | ❌ |
| Leer influencers (todos) | ✅ | ✅ | ✅ (limitado) | ❌ |
| Crear/editar influencer | ✅ | ✅ | ❌ | ❌ |
| Invitar influencer | ✅ | ✅ | ✅ | ❌ |
| Postular (aplicar) | ❌ | ❌ | ❌ | ✅ |
| Aceptar/rechazar postulación | ✅ | ✅ | ✅ | ❌ |
| Aceptar/rechazar invitación | ✅ (forzar) | ✅ (forzar) | ❌ | ✅ |
| Subir deliverable | ❌ | ❌ | ❌ | ✅ |
| Aprobar deliverable | ✅ | ✅ | ✅ | ❌ |
| Leer invoices | ✅ | ✅ | ✅ (propias) | ❌ |
| Crear invoice | ✅ | ✅ | ❌ | ❌ |
| Leer payroll | ✅ | ✅ | ❌ | ✅ (propio) |
| Crear payroll | ✅ | ✅ | ❌ | ❌ |
| Leer brands | ✅ | ✅ | ✅ (propia) | ❌ |
| Leer analytics | ✅ | ✅ | ❌ | ❌ |
| Sync Instagram | ✅ | ✅ | ❌ | ❌ |

### C.2 Estados y transiciones

**Campaign.status:** `draft → pending_influencers → active ⇄ paused → completed`; `draft/active → canceled`

**application_status:** `pending → accepted / rejected / expired / withdrawn`

**Deliverable.status:** `pending → in_review → approved → published`; `in_review → rejected → in_review` (re-entrega)

**invoice_status:** `draft → sent → paid`; `sent → overdue → partially_paid`; `draft → void`

**payroll_status:** `pending → approved → processing → paid / failed`

### C.3 Gaps de producto vigentes

| Gap | Descripción | Impacto |
|---|---|---|
| G-01 | Influencer no tiene UI de "Invitaciones" separada de Campañas | Medio |
| G-02 | No hay `/opportunities` dedicado para campañas open | Medio |
| G-06 | No hay notificaciones en tiempo real | Medio |
| G-07 | `campaign_influencers.status` legacy convive con `application_status` | Técnico |
| G-08 | Emails de invitación y de confirmación de booking (plantilla `resend.ts`) no se invocan en ningún endpoint — confirmado por auditoría de código | Medio |
| G-09 | No hay perfil público de influencer para marcas (`/brand-influencers/[id]`) | Bajo |
| G-10 | Sin onboarding guiado para marcas nuevas | Bajo |
| G-11 | "Campañas propias" del influencer no está en el modelo de permisos documentado | Medio — requiere decisión de producto |
| G-13 | Configuración → Lugares es un stub sin funcionalidad, pese a que la tabla `locations` ya existe y se usa en campañas/marcas | Bajo |
| G-14 (nuevo) | Duplicación de plantillas de email de booking (una activa inline, una muerta en `resend.ts`) | Bajo — limpieza técnica |
| G-15 (nuevo) | Migraciones del repo no reflejan el 100% del schema real (`brands` sin migración de creación) | Medio — riesgo de drift entre entornos |

---

*Fin del documento — SCENCE FDD v2.1, 2026-07-01.*
