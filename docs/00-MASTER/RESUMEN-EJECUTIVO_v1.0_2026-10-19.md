# Auditoría SCENCE — 2026-10-29

**Estado: parcial, con pendientes de permisos y validación autenticada.** No se crearon ramas, worktrees, proyectos ni infraestructura. Esta auditoría no ejecutó publicación en PROD ni escrituras de datos de producción.

## Flujo y concurrencia

- Inicio: `master`/`origin/master` `1c74f1f`; `origin/staging` `cc401d6`, tres commits detrás y sin divergencia. PR #130 sí integró staging; `62bb56d` (#131) y `1c74f1f` no estaban en staging. Vercel confirmó despliegues productivos de esos dos commits.
- Durante la auditoría otro proceso creó/publicó `fb624ed` sobre master, incluyendo los cambios de asistencia preexistentes y las dos correcciones de pruebas preparadas aquí. No fue un commit/push de esta auditoría. El árbol y el historial se preservaron; staging quedó cuatro commits detrás antes de sincronizar.
- Sincronización DEV: se prepara un commit documental sobre `fb624ed`, para avanzar únicamente staging sin force ni mover master. Ver el remoto para el SHA final; no confundir commit en Git con despliegue verificado.
- Al inicio había cambios previos de dependencias y asistencia. Otro proceso incorporó asistencia y después retiró los cambios de dependencias; esta auditoría no los sobrescribió. Ese proceso también cambió el checkout a `staging` local. No se refactoriza la app.

## Documentación

Actualizados en sus archivos existentes: `CLAUDE.md`, `SETUP.md`, guía de documentación, FDD mantenido, solución/arquitectura, datos, reportes, roadmap, estructura del portal Marca, matriz de riesgos y este resumen. El segundo FDD y diseños antiguos quedan identificados como históricos, sin borrar su contenido. Se corrigieron reglas de ramas/worktrees, roles, campañas privadas y configuración local. Los enlaces a paquetes ausentes ya no se presentan como fuentes disponibles. Requerimientos versionados conservan el catálogo y las evidencias existentes; no se escribió en sus tablas.

## Validación ejecutada

| Prueba | Resultado y alcance |
|---|---|
| `npm test` | 712 casos: 709 PASS, 0 FAIL, 0 SKIP, 3 TODO sobre el árbol local probado; incluye 2 pruebas documentales concurrentes aún sin commit. Suite versionada en fb624ed: 710 casos (707 PASS, 3 TODO). Cambios posteriores de otro proceso en Plan Pro no quedan cubiertos por ese resultado. |
| `tsc --noEmit` | PASS |
| `next lint` | PASS, 35 advertencias existentes; no se silencian ni se refactoriza para ocultarlas. |
| `next build` | PASS con `NODE_OPTIONS=--max-old-space-size=8192`. Primer intento sin red falló por Google Fonts; segundo agotó heap tras compilar; tercero completó. No se cambió configuración persistente. |
| Integración CRM en DEV | 8/8 PASS con Supabase real; datos sintéticos por ejecución y envío simulado, sin correos. No valida RLS porque usa service role. |
| RLS DEV | Inspección de 8 tablas: RLS habilitado. SELECT como authenticated con UUID sin membresías devuelve 0 filas en influencers, invoices, payroll_runs y organization_members. Sin cambios persistentes (ROLLBACK). No sustituye matriz multiusuario. |
| LOCAL funcional | Login abierto en navegador; Admin/Marca/Influencer sin sesión → 307 a login. APIs campaigns, brand/campaigns, influencer/my-campaigns y payroll → 401. |
| DEV navegador | Redirección al login Vercel confirmada. App autenticada pendiente; no se generó enlace de acceso porque revisión automática lo rechazó. |

Se reemplazaron dos pruebas omitidas del insert antiguo por ejecución del `ensureBrandRow` y RPC actuales con el arnés existente. La limpieza de integración CRM usa un identificador por ejecución para no borrar filas de otra ejecución concurrente. No se agregaron librerías ni suites duplicadas.

## Problemas y límites

- Dos TODO de nómina reproducen aceptación de `organization_id` del body e importes inválidos; un tercer TODO ya pasa. La suite no bloquea por TODO. Requieren revisión y aprobación sensible antes de cambiar negocio.
- Políticas RLS DEV aún consultan `profiles.role`; nómina y participaciones tienen políticas ALL por membresía de organización. Privilegios authenticated revisados incluyen escritura. Hallazgo de DEV, no afirmación de exposición comprobada en PROD. Detalle y seguimiento en matriz de riesgos.
- Los scripts RLS locales requieren `embedded-postgres`/`pg`, ausentes; no se instalaron ni se creó infraestructura. Faltan escenarios con roles reales y propiedad cruzada, y flujos completos autenticados de los tres portales.
- CI es manual; npm test no incluye integración real. El prebuild sí ejecuta la suite. No hay medida de cobertura que permita declarar exhaustividad.
- URL y refs JWT locales/CRM corresponden a DEV; PayPal sandbox y claves externas locales vacías. El respaldo productivo permanece ignorado y no se cargó. Variables remotas completas pendientes; DEV exige acceso Vercel.
- Historial DEV contiene las migraciones recientes de asistencia/progreso, facturas y RLS revisadas. No se aplicó ninguna ni se certificó paridad total con PROD.
- Falta verificar acceso público real a archivos Drive: el validador actual solo comprueba esquema/dominio.

Pendientes mantenidos en [roadmap](../IMPLEMENTATION_ROADMAP.md) y [riesgos](RIESGOS-Y-TAREAS_v1.0_2026-10-19.csv). No declarar auditoría cerrada mientras falten las comprobaciones autenticadas y revisión de permisos.

---

## Resumen histórico del 2026-10-19

# Resumen ejecutivo — SCENCE: estado actual

**Versión:** v1.0 · **Fecha:** 2026-10-19 · **Base:** `master` `ad7f76c` · **Estado:** Propuesta

> **Aviso.** Todo sale de **leer el código y los documentos**. **No se ejecutó el sistema ni las pruebas, y no se consultó producción.** Nada de aquí demuestra que algo funcione hoy en producción. Etiquetas y reglas: `GUIA-DE-DOCUMENTACION_v1.0_2026-10-19.md`.

## 1. Qué es SCENCE

La plataforma donde **una marca crea campañas de influencer marketing, las influencers postulan y SCENCE gestiona todo el proceso**: selección, brief, contratos, entregables, pagos y resultados.

Tiene tres portales y **81 pantallas** (Código revisado): Administrador (equipo SCENCE), Marcas (clientes) e Influencers (creadoras), más acceso público. Por diseño, cada marca solo ve lo suyo (según el código; no probado; con una excepción conocida, R-01).

## 2. Cómo fluye el trabajo

`Marca → Campaña (borrador) → Admin activa → Influencer postula → Aprobación → Brief y entregables → Resultados → Pago`

Reglas clave (`CLAUDE.md` §16): el estado de la postulación (`pendiente / aceptada / rechazada`) es la **única fuente de verdad**. Una influencer pendiente **no debería ver** el brief ni el PDF (según el código; no probado, T-01). Campaña "privada" **no** es oculta: pide Plan Pro para postular.

## 3. Los 10 módulos

Cada módulo tiene una ficha estándar en `FICHAS-MODULOS_v1.0_2026-10-19.md`. Este resumen no la repite.

| # | Módulo | Estado en una línea |
|---|---|---|
| 1 | Campañas y postulaciones | Construido; faltan pruebas de "quién ve qué". |
| 2 | Marcas | Construido; **una marca puede ver emails de influencers pendientes** (R-01). |
| 3 | Influencers y Plan Pro | Construido, con tests; falta confirmar el aviso de PayPal. |
| 4 | CRM (ventas) | Construido, con tests; riesgos al integrar ramas. |
| 5 | Reservas, contratos y entregables | Construido; falta confirmar el despliegue de una corrección. |
| 6 | Facturación y pagos | Construido; **no hay evidencia de cómo llega el dinero a la influencer**. |
| 7 | Ubicaciones | Parcial: solo el perfil de influencer usa el catálogo único. |
| 8 | KPI y dashboards | Construido, con **errores y definiciones inconsistentes** (R-09 a R-12; las definiciones están pendientes, D-03). |
| 9 | Avisos por email | Construido; el aviso de campaña no tiene test. |
| 10 | Acceso y seguridad | Construido; la seguridad depende de cada ruta (R-02). |

## 4. Qué está comprobado y qué no

| Tipo de evidencia | Estado hoy |
|---|---|
| **Código revisado** | Sí, para el flujo principal de cada módulo |
| **Test existe** | Sí, en parte (Pro, CRM, emails, contratos); casi nada de permisos por rol |
| **Test ejecutado** | **Ninguno** |
| **Solo documentado** | Datos de producción (auditoría 2026-10-09), 13 marcas Pro, pasarelas de pago |
| **Por verificar** | Estado real en Supabase y Vercel, RLS, envío a ~2.400 influencers |

## 5. Lo más importante (detalle y estado en `docs/00-MASTER/RIESGOS-Y-TAREAS_v1.0_2026-10-19.csv`)

Ningún punto está **verificado en producción**: son hallazgos del repositorio, y ninguna prueba se ejecutó. **Las prioridades son una propuesta, sujeta a tu revisión.**

| Prioridad | Qué | ID |
|---|---|---|
| **P0** | Una marca puede ver el email de influencers pendientes | R-01 |
| **P0** | 146 de 161 rutas de `master` importan `createAdminClient`; la protección depende del chequeo de cada ruta (el conteo no es una conclusión de seguridad; P-01 pendiente) | R-02 |
| **P0** | Migración irreversible que borra 5 columnas de campañas (sin aplicar según la auditoría del 2026-10-09; no verificado hoy) | R-03 |
| **P0** | Producción y Git desalineadas en migraciones (20 / 8 / 2, según la auditoría del 2026-10-09; no verificado hoy) | R-04 |
| **P1** | Dos migraciones con la misma versión (`20261010150000` y `20261005180000`; hallazgo del repositorio en ramas, no aplicado en producción) | R-05, R-06 |
| **P1** | KPI: seguidores en 0, tres definiciones de "completado", ingresos sin moneda | R-09 a R-12 |
| **P1** | 15 ramas [RC] sin auditar y 9 que tocan el mismo archivo de acceso | R-13, R-14 |
| **P1** | Faltan pruebas de visibilidad por rol | T-01 |

## 6. Ramas y respaldos (resumen)

**206 referencias** (79 locales + 127 remotas), **145 SHA distintos**, y **5 stashes**. Con la clasificación nueva: **109 integradas** y **97 con cambios propios**; **41 tienen rol de respaldo** (clasificación derivada; equivalencia exacta pendiente, P-07). Detalle y SHA completos: `docs/00-MASTER/data/ramas_sha_completo.tsv` y `docs/00-MASTER/data/ramas_clasificacion_v2.tsv`. No se modificó ni borró ninguna.

## 7. Estado de las decisiones

| ID | Decisión | Estado |
|---|---|---|
| D-01 | `FUNCTIONAL_DESIGN.md` como documento funcional principal | **Condicionada:** candidato; no es oficial hasta comparar ambos FDD (T-08) |
| D-02 | El contenido de la rama manda sobre su nombre; el respaldo es un rol aparte | **Aprobada** |
| D-03 | Definición única de «completado», «campañas en curso» e ingresos | **Pendiente:** primero revisar cómo se usan hoy en campañas, dashboards, facturación y pagos |
| D-04 | Una o varias ubicaciones por campaña | **Pendiente:** primero comprobar el comportamiento actual y su efecto en reservas, postulaciones y eventos |
| D-05 | 13 marcas con Pro heredado | **Pendiente:** primero identificar origen, beneficios y compromisos comerciales |
| P-01 | Qué cuenta cada cifra de rutas con acceso total a la base | **Pendiente:** no se concluye nada de seguridad |

## 8. Dónde está cada cosa

| Necesito… | Voy a… |
|---|---|
| Cómo se nombran y etiquetan las cosas | `docs/00-MASTER/GUIA-DE-DOCUMENTACION_v1.0_2026-10-19.md` |
| Qué cifras se corrigieron o siguen pendientes | `docs/00-MASTER/CONCILIACION_v1.0_2026-10-19.md` |
| Ficha de un módulo | `docs/00-MASTER/FICHAS-MODULOS_v1.0_2026-10-19.md` |
| Riesgos y tareas | `docs/00-MASTER/RIESGOS-Y-TAREAS_v1.0_2026-10-19.csv` |
| Detalle de una rama | `docs/00-MASTER/00-INDICE-MAESTRO.md` y el paquete `01` a `08` correspondiente |
| Libro completo | `docs/00-MASTER/LIBRO-IMPRIMIBLE.pdf` |
