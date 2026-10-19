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
