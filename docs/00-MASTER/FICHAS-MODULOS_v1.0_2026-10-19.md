# Fichas de módulos — SCENCE

**Versión:** v1.0 · **Fecha:** 2026-10-19 · **Base:** `master` `ad7f76c` · **Estado:** Propuesta

**Cómo usarlas.** Una ficha por módulo, con las mismas 7 secciones. No repiten el detalle: cada una indica su fuente. Evidencia: **Código revisado · Test existe · Test ejecutado · Solo documentado · Por verificar** (ver `GUIA-DE-DOCUMENTACION_v1.0_2026-10-19.md`). **Test ejecutado: ninguno en ningún módulo.** **Producción: no verificada en ningún módulo.** Los IDs (R-xx, T-xx) están en `docs/00-MASTER/RIESGOS-Y-TAREAS_v1.0_2026-10-19.csv`. Cada ficha distingue lo que muestra el código (hallazgo del repositorio) de las pruebas ejecutadas (ninguna) y de producción (no verificada). Las prioridades de la matriz son propuestas.

---

## 1. Campañas y postulaciones
- **Para qué sirve.** Crear campañas, postular, aprobar o rechazar.
- **Cómo funciona.** La marca crea la campaña en borrador y solo puede pedir aprobación; solo el Admin la activa. Puede ser abierta o privada (pide Plan Pro, pero se ve). La postulación queda pendiente. Un proceso diario cierra las vencidas.
- **Pantallas y procesos.** `POST /api/brand/campaigns`, `POST /api/campaigns`, `POST /api/influencer/campaigns/[id]/apply`, `PATCH /api/brand/campaigns/[id]/applications`, cron de cierre de postulaciones.
- **Datos y permisos.** `application_status` es la única fuente; no se escribe `campaign_influencers.status`. Pendiente: sin brief ni PDF; aprobada: con todo. Autorización por `organization_members` y `authorizeCampaignBrandAction`.
- **Qué está comprobado.** *Código revisado:* flujo completo. *Test existe:* pocos; los de Pro cubren el bloqueo de privadas. *Solo documentado:* reglas `CLAUDE.md` §16.1 y §16.3. *Por verificar:* que el listado incluya privadas; campo por campo al crear.
- **Problemas y dudas.** Faltan pruebas de "quién ve qué" (T-01). 5 ramas [RC] cambian quién aprueba o qué se ve (R-13).
- **Próxima acción.** Auditar la visibilidad del brief para postulaciones pendientes antes de integrar ramas [RC].
- **Detalle:** `docs/00-MASTER/README.md` §6.1 · `docs/00-MASTER/02-CAMPANAS/`

## 2. Marcas
- **Para qué sirve.** Cuentas de marca, equipos, planes y qué ve cada marca.
- **Cómo funciona.** Todas las marcas están al mismo nivel dentro de la plataforma SCENCE; SCENCE SpA es una marca de pruebas; SCENCE administra todas y una marca puede registrar otras (el registro de quién registró cada marca y su consulta aún no están implementados; las influencers también pueden registrar marcas). Técnicamente, cada marca tiene su propia organización, y la organización `Scence SpA` (tipo agencia) concentra la operación de plataforma (ver `CLAUDE.md` §16.9). Roles: dueño, gerente, finanzas, miembro. Planes básico, growth y pro (69.990 / 259.000 / 699.000 CLP según el código).
- **Pantallas y procesos.** Portal de marca (27 pantallas), `POST /api/auth/register-brand`, `/api/brand/*`.
- **Datos y permisos.** La marca solo ve sus campañas y solo a influencers aceptadas; no hay catálogo global. Colaboraciones entre marcas: solo Admin.
- **Qué está comprobado.** *Código revisado:* separación por organización, permisos por rol, plan y override. *Test existe:* 1 (`brand-plan-access`). *Solo documentado:* 13 marcas con Pro heredado. *Por verificar:* `campaigns.brand_id` sin migración visible (R-07).
- **Problemas y dudas.** La marca ve el email de influencers pendientes (R-01). Decisión comercial de las 13 marcas, pendiente (D-05; R-21).
- **Próxima acción.** Auditar la ruta de detalle de campaña de marca (R-01).
- **Detalle:** `docs/00-MASTER/README.md` §6.2 · `docs/00-MASTER/03-MARCAS/`

## 3. Influencers y Plan Pro
- **Para qué sirve.** Perfil de influencer, plan Gratis o Pro, términos y recibos.
- **Cómo funciona.** Términos → PayPal → activación. Pro se calcula en un solo lugar (`getInfluencerProStatuses`). Los términos tienen versión (`terms-v2.1`): si cambian, toda influencer Pro debe aceptarlos para postular a privadas.
- **Pantallas y procesos.** `upgradeToPro` → `/api/influencer/paypal/checkout` → `/complete`; `/api/influencer/terms`; recibos PDF.
- **Datos y permisos.** PayPal es la única pasarela con datos reales. No crear checkouts nuevos.
- **Qué está comprobado.** *Código revisado:* compra, estado Pro, términos, recibos. *Test existe:* integridad, bloqueo de producción y recibos de Pro. *Solo documentado:* que Stripe y MercadoPago no tienen movimientos. *Por verificar:* aviso de PayPal para suscripciones de influencers y precios en base frente a código (R-23).
- **Problemas y dudas.** Plan de carga manual de pagos no encontrado (R-24).
- **Próxima acción.** Revisar el aviso de PayPal y los precios (R-23).
- **Detalle:** `docs/00-MASTER/README.md` §6.3 · `docs/00-MASTER/04-INFLUENCER-PRO/`

## 4. CRM (ventas)
- **Para qué sirve.** Base de contactos de marcas y envío masivo de correos.
- **Cómo funciona.** Filtros y selección masiva; envío por tandas hasta 20.000 contactos, sin escribir a quien se dio de baja, sin duplicados, reanudable. Un lead "Interesada" crea la marca.
- **Pantallas y procesos.** `crm-leads/import`, `send-intro`, `bulk-send`, `bulk-send/process`, `jobs/[jobId]/resume`.
- **Datos y permisos.** Acceso a `crm_*`: según las migraciones revisadas, las tablas no tienen políticas RLS identificadas. El acceso efectivo y los permisos reales están pendientes de verificación. Bajas respetadas.
- **Qué está comprobado.** *Código revisado:* lista, filtros, envío y reanudación. *Test existe:* guardas de envío y reanudación, con prueba de concurrencia. *Por verificar:* rendimiento real con miles de envíos.
- **Problemas y dudas.** Tanda de 60 s y envío "fallido" que no se reabre (R-19). Selección hasta 50.000 frente a límite de 20.000 (R-18). Una rama trae una protección más antigua (R-17).
- **Próxima acción.** No integrar `feat/crm-contracts-pending` sin comparar su protección con la de `master`.
- **Detalle:** `docs/00-MASTER/README.md` §6.4 · `docs/00-MASTER/01-CRM/`

## 5. Reservas, contratos y entregables
- **Para qué sirve.** Eventos con confirmación, contratos desde plantilla y lo que la influencer debe entregar.
- **Cómo funciona.** Reserva con correo de confirmación. El contrato usa datos de la colaboración. La influencer sube entregables y confirma asistencia; si no responde a tiempo, un cron diario la marca como vencida.
- **Pantallas y procesos.** `/api/bookings`, `/api/contracts`, `/api/campaigns/[id]/deliverables`, `/api/influencer/deliverables/[id]/submit` y `/attendance`.
- **Datos y permisos.** La dirección vive en `metadata.address`; el lugar real, en `bookings`.
- **Qué está comprobado.** *Código revisado:* reservas, contratos, entregables y vencimiento. *Test existe:* contratos (dirección y colaboración) y vencimiento de asistencia. *Por verificar:* aprobación de entregables por la marca, paso a paso; que la corrección de dirección esté desplegada.
- **Problemas y dudas.** Una rama [RC] mueve el brief a después de confirmar asistencia.
- **Próxima acción.** Confirmar que la corrección de `contract-render` está desplegada (condición previa de R-03).
- **Detalle:** `docs/00-MASTER/README.md` §6.5 · `docs/00-MASTER/02-CAMPANAS/`

## 6. Facturación y pagos
- **Para qué sirve.** Planes de marca, suscripción Pro, facturas y pagos a influencers.
- **Cómo funciona.** Son cuatro cosas distintas: la marca paga su plan (PayPal); la influencer paga Pro (PayPal); Admin o Finanzas emiten facturas; existen nóminas y la influencer ve solo sus pagos.
- **Pantallas y procesos.** `/api/brand/billing`, `/api/paypal/*`, `/api/invoices`, `/api/payroll`, `/api/influencer/payments`.
- **Datos y permisos.** Facturas: Admin o permiso de facturación. Nóminas: Admin o Finanzas.
- **Qué está comprobado.** *Código revisado:* los cuatro flujos. *Test existe:* solo Pro y recibos. *Solo documentado:* Stripe y MercadoPago sin datos (rutas eliminadas de `master`). *Por verificar:* cómo llega el dinero a la influencer (R-22).
- **Problemas y dudas.** Ingresos sin moneda y con facturas "enviadas" (R-12).
- **Próxima acción.** Confirmar con Finanzas el proceso real de pago a influencers (R-22).
- **Detalle:** `docs/00-MASTER/README.md` §6.6 · `docs/00-MASTER/04-INFLUENCER-PRO/`

## 7. Ubicaciones
- **Para qué sirve.** Un catálogo único: país, región, comuna y lugar.
- **Cómo funciona.** Tabla `locations` autorreferenciada; la base valida la jerarquía. Solo el Admin la gestiona.
- **Pantallas y procesos.** `/api/locations` (admin de plataforma).
- **Datos y permisos.** Los domicilios de influencers son privados. `brand_locations` se migró a `locations` y se eliminó (2026-10-28).
- **Qué está comprobado.** *Código revisado:* jerarquía y acceso admin; en `master` solo el perfil de influencer lo usa. *Test existe:* parcial. *Por verificar:* estado real en producción.
- **Problemas y dudas.** Dos modelos compiten (R-15). Versión de migración repetida (R-06; hallazgo del repositorio en ramas, no aplicado en producción).
- **Próxima acción.** Pendiente (D-04): primero comprobar el comportamiento actual de campañas y su efecto en reservas, postulaciones y eventos.
- **Detalle:** `docs/00-MASTER/README.md` §6.7 · `docs/00-MASTER/05-UBICACIONES/` · `docs/locations/README.md`

## 8. KPI y dashboards
- **Para qué sirve.** Paneles y reportes para admin, marca e influencer.
- **Cómo funciona.** Los números se calculan al cargar la pantalla desde campañas, facturas, pagos y entregables.
- **Pantallas y procesos.** `/admin-dash`, `/admin-analytics`, `/brand-dash`, `/inf-dash`, rankings, reporte de campaña.
- **Datos y permisos.** Protegidos por el chequeo de cada ruta (service role).
- **Qué está comprobado.** *Código revisado:* paneles, rankings, reportes. *Test existe:* solo en ramas. *Solo documentado:* `REPORT_DESIGN.md` v1.0, desfasado. *Por verificar:* origen y frescura de las métricas de Instagram (R-25).
- **Problemas y dudas.** Seguidores en 0 (R-09); tres definiciones de "completado" (R-10); "en curso" y ranking (R-11); ingresos (R-12); dos `/admin-requirements` (R-16).
- **Próxima acción.** Pendiente (D-03): primero revisar cómo se usan hoy «completado», «campañas en curso» e ingresos en campañas, dashboards, facturación y pagos. No integrar `fix/kpi-audit-2026-10-12` antes (cambia cifras históricas).
- **Detalle:** `docs/00-MASTER/README.md` §6.8 · `docs/00-MASTER/06-KPI-DASHBOARDS/`

## 9. Avisos por email
- **Para qué sirve.** Avisar campañas nuevas sin escribir a quien no debe.
- **Cómo funciona.** Al activar una campaña abierta o privada, se avisa al roster en lotes de 100. No se reenvía al reactivar. Respeta las bajas. Una influencer inactiva nunca recibe correos (barrera central en `getResend()`).
- **Pantallas y procesos.** `resolvePendingCampaignAnnouncement`, `announceCampaignToInfluencers`, `notify-influencers` (`maxDuration` 300).
- **Datos y permisos.** Idempotencia en `campaign_influencer_notifications`; opt-out en `profiles.metadata`.
- **Qué está comprobado.** *Código revisado:* aviso y barrera. *Test existe:* barrera de inactivas y bajas; **el aviso no tiene test**. *Solo documentado:* ~2.400 influencers (`CLAUDE.md`). *Por verificar:* que el envío termine completo.
- **Problemas y dudas.** Los 2 crons `cron/*` no declaran `maxDuration` (R-20).
- **Próxima acción.** Verificar el envío completo en un entorno aparte (R-20).
- **Detalle:** `docs/00-MASTER/README.md` §6.9 · `docs/00-MASTER/07-AUTH-OTROS/`

## 10. Acceso, registro y seguridad
- **Para qué sirve.** Ingreso, registro, roles y quién puede ver qué.
- **Cómo funciona.** Ingreso con correo y clave. La influencer se registra con formulario; la marca, por el servidor. Los permisos salen de `organization_members`. El middleware solo redirige al portal (no es seguridad). Cada día se sincronizan seguidores de Instagram con Meta.
- **Pantallas y procesos.** `/login`, `/register`, `POST /api/auth/register-brand`, `src/middleware.ts`, `sync-instagram`.
- **Datos y permisos.** Nunca autorizar con `profiles.role`. 146 de 161 rutas de `master` importan `createAdminClient` (conteo de importaciones; no es una conclusión de seguridad, P-01).
- **Qué está comprobado.** *Código revisado:* permisos centrales y redirección. *Test existe:* sincronización de Instagram y barrera de inactivas; no hay cobertura amplia de permisos por rol. *Por verificar:* que cada ruta compruebe permisos; RLS de `subscriptions`.
- **Problemas y dudas.** Seguridad ruta por ruta (R-02); RLS de `subscriptions` (R-08); 9 SHA tocan `middleware.ts` (R-14).
- **Próxima acción.** Primero definir qué cuenta cada auditoría de rutas (P-01); después auditar con un método fijo (R-02).
- **Detalle:** `docs/00-MASTER/README.md` §6.10 · `docs/00-MASTER/07-AUTH-OTROS/` · `docs/00-MASTER/00-MASTER/tecnico/`
