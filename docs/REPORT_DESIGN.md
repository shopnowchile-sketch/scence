# SCENCE — Report Design Document (RDD)
**Versión:** 1.0 | **Fecha:** 2026-06-03

---

## 1. Dashboard Admin

### Estado: ✅ EXISTE — API: `GET /api/dashboard`

### KPIs en tiempo real

| KPI | Cálculo | Fuente |
|---|---|---|
| Campañas activas | COUNT campaigns WHERE status NOT IN (canceled, completed) | `campaigns` |
| Total influencers | COUNT influencers WHERE organization_id = orgId | `influencers` |
| Ingresos del mes (CLP) | SUM invoices.total WHERE status IN (paid, sent) AND issue_date en mes actual | `invoices` |
| Payroll del mes (CLP) | SUM payroll_runs.total_amount WHERE status IN (approved, processing, paid) en mes actual | `payroll_runs` |
| Margen (CLP) | Ingresos - Payroll | Calculado |
| Margen (%) | (Margen / Ingresos) * 100 | Calculado |

### Secciones del dashboard

1. **KPIs cards** (6 métricas principales)
2. **Gráfico Revenue vs Payroll** — últimos 6 meses (bar chart, Recharts)
3. **Deliverables pendientes** — top 5 entregables en status pending/in_review con influencer y campaña
4. **Actividad reciente** — últimas 5 campañas actualizadas

### Datos del gráfico (6 meses)

Para cada mes: revenue (sum invoices paid/sent) + payroll (sum payroll_runs paid)  
Se generan 6 queries paralelas con `Promise.all`.

---

## 2. Dashboard Marca

### Estado: ✅ EXISTE — API: `GET /api/brand/campaigns`

### KPIs

| KPI | Cálculo |
|---|---|
| Campañas activas | COUNT campaigns WHERE brand_id = brand.id AND status = 'active' |
| Influencers | COUNT DISTINCT influencer_id de campaign_influencers en campañas de la marca |
| Para revisar | COUNT campaign_deliverables WHERE status = 'in_review' en campañas de la marca |

### Secciones

1. **KPIs cards** (3 métricas)
2. **Contenido para revisar** — lista de deliverables in_review con link al contenido
3. **Lista de campañas** — con progreso de deliverables (% completado), status badge

---

## 3. Dashboard Influencer

### Estado: ✅ EXISTE (básico) — API: `GET /api/influencer/campaigns`, `GET /api/influencer/tasks`

### Contenido
- Lista de campañas activas del influencer
- Tasks/deliverables pendientes por fecha de vencimiento
- Próximos bookings

---

## 4. Analytics Admin

### Estado: ✅ EXISTE — API: `GET /api/analytics?range=6m`

### Parámetros
- `range`: `1m | 3m | 6m | 12m` (default: 6m)

### Métricas disponibles

| Sección | Métricas |
|---|---|
| **Campaign Stats** | Total, activas, completadas, budget total, budget gastado, distribución por tipo |
| **Deliverable Stats** | Total, tasa de completación (%), distribución por status, distribución por plataforma |
| **Revenue Trend** | Por mes: revenue (invoices), payroll, campañas activas |
| **Top Influencers** | Top 8 por total de fees recibidos, con seguidores y engagement |

### Visualizaciones en UI (AnalyticsClient.tsx)
- Gráficos Recharts: BarChart, LineChart, PieChart
- Tablas de top influencers
- Resumen de deliverables por estado

---

## 5. KPIs globales

### Definición formal

| KPI | Definición | Periodicidad |
|---|---|---|
| Active Campaigns | Campañas en status activo (no canceladas, no completadas) | Tiempo real |
| Total Influencers | Influencers activos en el roster | Tiempo real |
| Monthly Revenue (CLP) | Suma de invoices pagadas/enviadas en el mes | Mensual |
| Monthly Payroll (CLP) | Suma de payroll runs aprobados/pagados en el mes | Mensual |
| Gross Margin | Revenue - Payroll | Mensual |
| Gross Margin % | (Revenue - Payroll) / Revenue * 100 | Mensual |
| Deliverable Completion % | Deliverables approved+published / total deliverables | Por campaña |
| Application Acceptance Rate | applications accepted / total applications | Por campaña |
| Avg Fee per Influencer | Total fees / total influencers en campaña | Por campaña |

---

## 6. Reporte PDF por campaña

### Estado: ✅ EXISTE — Ruta: `/campaigns/[id]/report` — API: `GET /api/campaigns/[id]/report`

### Contenido del reporte
- Header con nombre de campaña, marca, fechas, status
- KPIs de la campaña: influencers, deliverables, presupuesto, gastado
- Lista de influencers participantes con fee y status
- Lista de deliverables con status y URLs
- Progreso general

### Generación
- Página Next.js con `@media print` styles
- `window.print()` desde el botón en la UI
- No usa PDF library — renderiza HTML optimizado para impresión

### Acceso
- Solo admin puede acceder a `/campaigns/[id]/report`
- Marca puede ver su campaña pero sin el reporte PDF (pendiente habilitar en portal marca)

---

## 7. Reporte de influencer (vista individual)

### Estado: ✅ EXISTE — API: `GET /api/campaigns/[id]/influencer-report`

### Contenido
- Datos del influencer en la campaña
- Lista de deliverables con status
- Total fee acordado

---

## 8. Revenue Reports

### Estado: ⚠️ PARCIAL — Solo en Analytics y Dashboard

### Disponible actualmente
- Revenue por mes (últimos 6 o 12 meses)
- Revenue vs Payroll comparativo
- Total revenue del mes en dashboard

### Pendiente
- Export CSV/Excel de revenue por período
- Breakdown de revenue por marca
- Breakdown de revenue por tipo de campaña
- P&L mensual formal

---

## 9. Performance Reports

### Estado: ⚠️ PARCIAL — Métricas básicas de completación

### Disponible actualmente
- Tasa de completación de deliverables por campaña
- Distribución de deliverables por plataforma
- Distribución por status

### Pendiente
- Métricas de performance post-publicación (views, likes, reach)
- Comparación de performance entre influencers
- Tracking de clicks en affiliate links
- Tasa de aprobación primera entrega vs. segunda entrega

---

## 10. Reportes descargables

### Actualmente disponibles
| Reporte | Formato | Acceso |
|---|---|---|
| Campaign Report | HTML → Print to PDF | Admin (`/campaigns/[id]/report`) |

### Pendientes recomendados
| Reporte | Formato | Descripción |
|---|---|---|
| Roster de influencers | CSV | Export de todos los influencers con datos sociales |
| Resumen de campaña | PDF | Versión mejorada del report actual, con branding |
| Facturas | PDF | Factura individual con datos fiscales |
| Revenue Statement | Excel | P&L mensual/trimestral |
| Deliverables Log | CSV | Historial de entregas por campaña |
| Brand Campaign Summary | PDF | Versión para marcas del reporte de campaña |

---

## 11. Reportes futuros recomendados

| Reporte | Prioridad | Complejidad |
|---|---|---|
| ROI por campaña (revenue generado vs. costo) | Alta | Media |
| Benchmark de engagement por categoría de influencer | Alta | Alta |
| Tasa de conversión de affiliate links | Alta | Baja |
| Tiempo promedio de aprobación de contenido | Media | Baja |
| Comparativa de performance entre marcas (benchmark) | Media | Alta |
| Predicción de presupuesto (basada en histórico) | Baja | Alta |
| Reporte regulatorio / fiscal (para facturación CLP+IVA) | Media | Media |
