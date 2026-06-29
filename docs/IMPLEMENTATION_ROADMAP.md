# SCENCE — Implementation Roadmap
**Versión:** 1.0 | **Fecha:** 2026-06-03

---

## 1. Estado actual — % completado por área

| Área | Completado | Notas |
|---|---|---|
| **Portal Admin** | 92% | Pendiente: Stripe live, emails en todos los flows, mobile QA |
| **Portal Marca** | 75% | Pendiente: billing, perfil, lista campañas, build fix |
| **Portal Influencer** | 65% | Pendiente: invitaciones, oportunidades, earnings |
| **Schema / DB** | 95% | Pendiente: dropear ENUM legacy, columnas futuras opcionales |
| **Auth** | 90% | Pendiente: onboarding flow |
| **Integraciones** | 60% | Stripe no activado, WhatsApp/Drive/Airtable no implementados |
| **Emails** | 70% | Templates listos, falta conectar todos los flows |
| **Analytics** | 80% | Pendiente: export, filtros avanzados |
| **AI Features** | 85% | AI Builder existe, falta ANTHROPIC_API_KEY en Vercel |
| **Tests** | 0% | Sin coverage |

**Total estimado:** ~78% hacia MVP completo

---

## 2. Funcionalidades completadas

### Portal Admin ✅
- [x] Dashboard con KPIs reales (revenue, payroll, margen, campañas, influencers)
- [x] Gráfico revenue vs payroll 6 meses
- [x] CRUD Campañas (crear, editar, detalle, eliminar)
- [x] AI Campaign Builder (Claude Haiku)
- [x] Filtros y paginación de campañas
- [x] CRUD Influencers (lista/grid, alta, perfil, editar)
- [x] Bulk import influencers (hasta 1500 por lote, CSV)
- [x] Data Quality (dedup, merge, hard delete)
- [x] Instagram Sync (Apify, async polling, followers)
- [x] Gestión de Bookings (multi-influencer)
- [x] Emails de confirmación de bookings (Resend)
- [x] Billing: Invoices con IVA 19% CLP
- [x] Billing: Payroll (pending → approved → paid)
- [x] Brands: lista, detalle, invitar portal marca (magic link)
- [x] Affiliate Links con tracking de clicks
- [x] Analytics: métricas por rango, top influencers, deliverable stats
- [x] PDF Report de campaña
- [x] Settings: perfil, organización, team members con roles
- [x] Tickets: bug tracker con AI review (Claude)
- [x] Middleware de routing por rol
- [x] Multi-tenancy completo (org_id en todo)
- [x] Stripe scaffold (checkout, portal, webhooks — no activado)
- [x] Resend scaffold (4 templates — no todos conectados)

### Portal Marca ✅
- [x] Login / registro self-service (`/register/brand`)
- [x] Auto-provision brands record en primer login
- [x] Dashboard: KPIs, deliverables para revisar, lista campañas
- [x] Crear campaña (private/open, todos los parámetros)
- [x] Detalle de campaña con progreso
- [x] Aprobar/rechazar deliverables con notas
- [x] Catálogo de influencers (búsqueda, filtros, tarifa referencial)
- [x] Invitar influencer (fee, mensaje, deliverables_spec)
- [x] Ver y gestionar postulaciones/invitaciones (aceptar/rechazar)
- [x] Auto-creación de deliverables al aceptar

### Portal Influencer ✅
- [x] Dashboard influencer
- [x] Mis campañas activas
- [x] Tasks / Deliverables (ver, subir URL, marcar completado)
- [x] Mis Marcas
- [x] Perfil propio
- [x] Detalle de campaña
- [x] Postular a campaña open (API + lógica — sin UI dedicada)

### Schema / DB ✅
- [x] Schema inicial completo (23 tablas)
- [x] Migraciones de schema portal marca (visibility, application_status, origin, etc.)
- [x] Índices optimizados
- [x] Triggers (updated_at, invoice_number, budget_spent)
- [x] RLS habilitado en tablas principales

---

## 3. Funcionalidades parcialmente completas

| Funcionalidad | Estado | Lo que falta |
|---|---|---|
| Portal Influencer — Invitaciones | API existe, UI pendiente | Página `/invitations` |
| Portal Influencer — Oportunidades | API existe (`/api/influencer/campaigns/open`), UI pendiente | Página `/opportunities` |
| Portal Marca — Lista campañas | Existe como redirect, sin lista real | Página `/brand/campaigns` con tabla y botón Nueva |
| Emails en flujo de invitación marca | Template existe, no se dispara | Agregar `getResend().emails.send()` en `/api/brand/campaigns/[id]/invite` |
| Google Calendar sync | OAuth implementado, UI/UX no expuesta | Botón en bookings para agregar a Google Calendar |
| Stripe billing | Scaffold completo | Activar con cuenta real de Stripe |
| Notificaciones in-app | Tabla `notifications` existe | UI de campana + badge + lista |

---

## 4. Funcionalidades pendientes

### Alta prioridad
| # | Funcionalidad | Archivos a crear/modificar |
|---|---|---|
| P-01 | Fix build Fase B (npm run build falla) | Investigar error exacto |
| P-02 | `/invitations` — Portal Influencer | `src/app/(influencer)/invitations/page.tsx` |
| P-03 | `/opportunities` — Portal Influencer | `src/app/(influencer)/opportunities/page.tsx` |
| P-04 | Email al invitar influencer | `src/app/api/brand/campaigns/[id]/invite/route.ts` |
| P-05 | `ANTHROPIC_API_KEY` en Vercel | Dashboard Vercel → Settings |

### Media prioridad
| # | Funcionalidad | Descripción |
|---|---|---|
| P-06 | `/brand/campaigns` lista dedicada | Lista con filtros + Nueva Campaña |
| P-07 | `/brand/billing` | Facturas de la marca (consume invoices con brand_id) |
| P-08 | `/brand/profile` | Editar datos de la marca |
| P-09 | Dropear `campaign_influencers.status` ENUM | Migrar código admin a usar `application_status` |
| P-10 | Stripe live | Activar con cuenta real |
| P-11 | Notificaciones in-app | UI de campana en header |

### Baja prioridad
| # | Funcionalidad | Descripción |
|---|---|---|
| P-12 | `/brand/influencers/[id]` perfil público | Detalle de influencer para marca |
| P-13 | `/influencer/earnings` | Historial de pagos del influencer |
| P-14 | Onboarding flow para marcas nuevas | Tour guiado en primer login |
| P-15 | PDF facturas | Generación de PDF para invoices |
| P-16 | Export CSV roster influencers | Descarga del roster completo |
| P-17 | Mobile responsive QA | Revisar UI en mobile |
| P-18 | Tests unitarios | Al menos para APIs críticas |

---

## 5. Bugs conocidos

| ID | Bug | Severidad | Archivo |
|---|---|---|---|
| B-01 | `npm run build` falla (Fase B) | Crítico | Por investigar |
| B-02 | `/brand/campaigns` redirige a dashboard | Alto | `(brand)/brand/campaigns/page.tsx` |
| B-03 | `POST /api/brand/register` falla silenciosamente si org no encontrada | Medio | `(brand)/layout.tsx` |
| B-04 | Filtro platform en catálogo influencers aplica en memoria (post-fetch) | Medio | `GET /api/brand/influencers` |
| B-05 | `campaign_influencers.status` ENUM no se actualiza al usar nuevo flujo | Medio | Múltiples API routes |
| B-06 | Email de invitación a influencer no se envía desde portal marca | Medio | `POST /api/brand/campaigns/[id]/invite` |
| B-07 | `ANTHROPIC_API_KEY` no configurada en Vercel — AI Builder no funciona en prod | Medio | Vercel env vars |

---

## 6. Prioridades inmediatas (esta semana)

1. **Fix build Fase B** — el build de Vercel falló. Investigar con `npm run build 2>&1 | head -60` en local
2. **Commit y deploy Fase B** una vez resuelto el build
3. **Test del flujo end-to-end** en producción (ver checklist en HANDOFF)
4. **P-02 + P-03** — `/invitations` y `/opportunities` en portal influencer (bajo effort, alto impacto)
5. **P-04** — Agregar email en `/api/brand/campaigns/[id]/invite`
6. **P-05** — Configurar `ANTHROPIC_API_KEY` en Vercel

---

## 7. Quick Wins (< 2 horas cada uno)

| Quick Win | Esfuerzo | Impacto |
|---|---|---|
| Agregar `ANTHROPIC_API_KEY` en Vercel | 5 min | AI Builder funciona en prod |
| Agregar email en POST invite | 30 min | Influencers notificados |
| `/brand/profile` — solo consume GET /api/brand/me | 1h | Marcas pueden verse a sí mismas |
| Agregar link "Ver postulaciones" en campaign detail marca | 15 min | UX |
| Fix filtro platform en catálogo (query-side) | 30 min | Performance |

---

## 8. MVP Definition

El MVP de SCENCE está definido como el sistema capaz de gestionar el flujo completo sin intervención manual de SCENCE en cada paso:

### MVP Checklist

```
[ ] Marca se registra sola
[ ] Marca crea campaña
[ ] Marca encuentra e invita influencer
[ ] Influencer recibe notificación (email)
[ ] Influencer acepta invitación
[ ] Deliverables se crean automáticamente
[ ] Influencer sube contenido
[ ] Marca revisa y aprueba
[ ] Admin emite factura
[ ] Admin ejecuta payroll

Adicional:
[ ] Marca puede crear campaña open
[ ] Influencer puede postular
[ ] Marca acepta postulación → mismo flujo
```

**Estado actual del MVP:** ~80% — faltan principalmente P-02 y P-03 (influencer side)

---

## 9. Fase 2 (próximo sprint)

Objetivo: Completar los portales y conectar integraciones externas.

| Entregable | Descripción |
|---|---|
| Portal Influencer completo | `/invitations`, `/opportunities`, `/earnings` |
| Portal Marca completo | `/campaigns` lista, `/billing`, `/profile` |
| Stripe activado | Checkout y subscription management |
| Emails en todos los flows | Invitación, aceptación, rechazo, aprobación de content |
| Notificaciones in-app | UI de campana con badge |
| Fix deuda técnica DT-01 | Dropear ENUM legacy |

---

## 10. Fase 3 (futuro)

Objetivo: Diferenciación y escalamiento.

| Entregable | Descripción |
|---|---|
| Instagram Graph API | Métricas de performance reales post-publicación |
| Contratos digitales | PDF generado + firma electrónica (DocuSign o similar) |
| Onboarding flows | Para marcas y influencers nuevos |
| Mobile responsive QA | App mobile-first |
| Webhooks outbound | Para integración con sistemas externos de clientes |
| Marketplace de influencers | Portal público donde influencers pueden registrarse solos |
| Reportes avanzados | ROI, benchmark, export Excel |
| Multi-idioma | Español + English |

---

## 11. Escalamiento

### Supabase (base de datos)
- **Actual:** Plan free/starter — suficiente hasta ~50k requests/día
- **Cuando escalar:** Pasar a Pro o Business cuando se superen conexiones concurrentes
- **Optimización:** Agregar materialized views para analytics si las queries se vuelven lentas

### Vercel
- **Actual:** Serverless functions auto-escalan
- **Límite:** Execution time de 10s en free, 60s en Pro
- **Riesgo:** `GET /api/analytics` hace 10+ queries paralelas — puede acercarse al límite con muchos datos

### Stripe
- **Actual:** Scaffold listo, no activado
- **Para activar:** Cuenta Stripe + 4 env vars

### Apify
- **Actual:** Plan de pago por actor run
- **Optimización:** Cache de sync (no re-sincronizar si `synced_at < 7 días`)

### Recomendaciones de arquitectura para escala
1. Agregar Redis/Upstash para caching de dashboard y analytics
2. Mover auto-notificaciones a Supabase Edge Functions (en lugar de en API routes)
3. Considerar queue (Bull/BullMQ o Inngest) para jobs asíncronos (bulk import, sync masivo)
4. Separar el bundle admin/marca/influencer en chunks distintos de Next.js
