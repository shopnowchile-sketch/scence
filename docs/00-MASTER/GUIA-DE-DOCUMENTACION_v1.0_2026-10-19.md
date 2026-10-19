# Guía de documentación — SCENCE

**Versión:** v1.0 · **Fecha:** 2026-10-19 · **Base:** `master` `ad7f76c` (SHA completo en `data/ramas_sha_completo.tsv`) · **Estado:** Propuesta (espera aprobación)

**Para qué sirve.** Es una página que dice cómo se llaman las cosas, dónde vive cada dato y cómo se etiqueta la evidencia. No repite contenido: enlaza a él.

**Lo que NO hace.** No reemplaza, edita, mueve ni renombra ningún documento existente. Las correcciones a documentos antiguos se registran en `CONCILIACION_v1.0_2026-10-19.md`.

---

## 1. Fuente de verdad por tipo de información

**Estados de la propuesta:** **Sin conflicto conocido** = no encontré contenido contradictorio · **En conflicto** = hay contenido distinto sin resolver (no se declara oficial) · **Contexto histórico** = se conserva, no se mantiene. **Ninguna fuente está oficializada: esta tabla es una propuesta sujeta a tu aprobación.** Todas las rutas son completas desde la raíz del repositorio (empiezan con `docs/`), salvo `CLAUDE.md`.

| Información | Fuente única | Estado de la propuesta | Qué hacen los demás documentos |
|---|---|---|---|
| Ramas y SHA completos | `docs/00-MASTER/data/ramas_sha_completo.tsv` | Sin conflicto conocido | `docs/00-MASTER/00-INDICE-MAESTRO.md` es su vista legible; `docs/00-MASTER/09-MATRIZ-COMPARATIVA/matriz.csv` es otra vista agrupada. Solo se enlazan. |
| Clasificación nueva de ramas | `docs/00-MASTER/data/ramas_clasificacion_v2.tsv` (derivada; no altera la fuente). Agrega una **fila de encabezado** que el original no tiene y conserva íntegras las 8 columnas y las 206 filas originales | Sin conflicto conocido (derivada) | — |
| Stashes | `docs/00-MASTER/data/stashes.tsv` | Sin conflicto conocido | Solo enlazan. |
| Reglas de negocio | `CLAUDE.md` (secciones 16 y 17) | Sin conflicto conocido, salvo una cifra histórica de rutas (ver `CONCILIACION` P-01 y P-02) | Solo citan. |
| Diseño funcional | `docs/FUNCTIONAL_DESIGN.md` (**candidato principal**; D-01 **condicionado** a comparar ambos FDD, tarea T-08) | **En conflicto** (no oficial) | `docs/SCENCE_FDD_v2.2.*` se conservaría como histórico solo si la comparación no encuentra contradicciones funcionales. Sin mover ni renombrar. |
| Estado real de la plataforma y datos | `docs/current-state/` (auditoría 2026-10-13; solo documentado, no repetida hoy) | Sin conflicto conocido | `SOLUTION_DESIGN`, `DATA_DESIGN`, `REPORT_DESIGN` e `IMPLEMENTATION_ROADMAP` (junio 2026) son contexto histórico; ya apuntan a `current-state/`. |
| Riesgos y tareas | `docs/00-MASTER/RIESGOS-Y-TAREAS_v1.0_2026-10-19.csv` | Propuesta (nuevo; prioridades propuestas) | Las secciones de riesgos de paquetes y README no se editan; la documentación nueva enlaza al CSV. |
| Migraciones y deriva | `docs/audits/migration_drift_2026-10-09.md` y `docs/audits/drop_legacy_campaign_columns_checklist.md` | Evidencia **solo documentada** (2026-10-09, no repetida hoy) | Solo citan. |
| Ubicaciones | `CLAUDE.md` §16.11 y `docs/FUNCTIONAL_DESIGN.md` AD-17.1 (según `docs/locations/README.md`) | Sin conflicto conocido; D-04 (una o varias por campaña) pendiente | — |
| Diagramas | `docs/diagrams/` (`.drawio`) | Sin conflicto conocido | Las copias en `docs/00-MASTER/_respaldo-previo-20261019/` y `docs/_respaldos-current-state/` son respaldo. |
| Cifras del código (rutas, pantallas, migraciones) | Se recalculan con los comandos de la sección 6 | Sin conflicto conocido | **Nunca se copian a mano.** |
| Libro imprimible | `docs/00-MASTER/LIBRO-IMPRIMIBLE.pdf` | Derivado | Se regenera; no se edita. |

## 2. Nomenclatura

| Elemento | Regla | Ejemplo |
|---|---|---|
| Documento | `TEMA_vX.Y_AAAA-MM-DD.ext` (tema en mayúsculas con guiones) | `RIESGOS-Y-TAREAS_v1.0_2026-10-19.csv` |
| Dato derivado | `tema_vN.ext` (minúsculas; `N` = versión de columnas, no fecha) | `ramas_clasificacion_v2.tsv` |
| Fecha | Siempre ISO `AAAA-MM-DD` | `2026-10-19` |
| Versión de documento | `vX.Y` | `v1.0` |
| Otras versiones | Con prefijo, para no mezclarlas | `fdd-v2.4`, `terms-v2.1` |
| Rama | `` `nombre` `` + SHA corto de 7 | `` `fix/kpi-audit-2026-10-12` `e112444` `` |
| Cabecera | Versión · Fecha · Base · Estado | ver arriba |
| Estado de documento | Propuesta · Aprobado · Histórico · Respaldo (todo documento nuevo nace como Propuesta) | — |

Los nombres antiguos (`SCENCE_FDD_v2.2.*`, `20261019-172357`) no se renombran. La versión que cuenta es la declarada **dentro** del documento.

## 3. Estado de contenido y rol de las ramas

La clase se asigna **por SHA (contenido)**, no por el nombre de la rama. El respaldo es un **rol**, no una clase.

| Nuevo | Significado | Antes |
|---|---|---|
| Estado: **Integrada** | Sin diferencias funcionales con `master` | Clase A |
| Estado: **Con cambios propios** | Tiene trabajo que `master` no tiene | Clase B |
| Rol: **Respaldo** | Copia histórica por su nombre o uso | Clase D |
| Aviso: **Copia idéntica** | Comparte SHA con otra(s) rama(s) | "Clase C" (era solo una nota) |
| Aviso: **Sin guardar / sin seguimiento** | Trabajo no confirmado o sin rama remota | "Clase E" (era solo una nota) |
| **[RC]** | Cambia quién ve o aprueba algo (Regla Cero) | sin cambio |

**Regla para respaldos:** si el SHA tiene `adelante = 0` respecto de `master` → *Integrada*; si tiene `adelante > 0` → *Con cambios propios* (equivalencia exacta con `git cherry`: pendiente). Si algún nombre del mismo SHA ya era B, todos quedan *Con cambios propios*. Decisión D-02: **aprobada** (el contenido manda sobre el nombre; el respaldo se registra aparte).

**Archivo derivado.** `docs/00-MASTER/data/ramas_clasificacion_v2.tsv` agrega una **fila de encabezado** (el original no tiene) y conserva íntegras las 8 columnas y las 206 filas originales (verificado con `cmp`). Las columnas 6 a 8 no tienen significado documentado y se conservan sin interpretar (`CONCILIACION` P-06). La columna `base_estado` indica qué estados son derivados.

## 4. Evidencia (cinco etiquetas, sin letras)

| Etiqueta | Significa | Antes |
|---|---|---|
| **Código revisado** | Lo leí escrito en el código | C |
| **Test existe** | Hay una prueba automática (no se ejecutó) | T |
| **Test ejecutado** | Se corrió y se vio el resultado. **Ninguno a esta fecha.** | E |
| **Solo documentado** | Lo dice un documento; no lo confirmé en código | D |
| **Por verificar** | No se pudo confirmar | V |

**Producción es un campo aparte** (no una etiqueta de evidencia): `No verificado` · `Documentado (fuente, fecha)` · `Verificado (fecha, método)`. A esta fecha **ningún dato está verificado en producción**.

## 5. Prioridad e impacto (matriz de riesgos)

**Las prioridades P0 a P3 son una propuesta, sujeta a tu revisión;** no son una decisión oficial.

| Prioridad | Cuándo |
|---|---|
| **P0** | Puede exponer datos privados, perder datos o romper permisos |
| **P1** | Puede dar cifras o comportamientos incorrectos, o bloquear integrar ramas |
| **P2** | Decisión comercial, operativa o de verificación pendiente |
| **P3** | Orden y mantenimiento |

Impacto: **Alto** (privacidad, dinero, datos) · **Medio** (cifras, operación) · **Bajo** (orden, estilo).

## 6. Cómo recalcular las cifras (solo lectura, sobre `master`)

| Cifra | Comando | Valor 2026-10-19 |
|---|---|---|
| Rutas API | `git ls-tree -r master --name-only \| grep -E '^src/app/api/.*/route\.ts$' \| wc -l` | 161 |
| Rutas que importan `createAdminClient` | `git grep -l createAdminClient master -- 'src/app/api/**/route.ts' \| wc -l` | 146 |
| Pantallas | `git ls-tree -r master --name-only \| grep -E '^src/app/.*/page\.tsx$\|^src/app/page\.tsx$' \| wc -l` | 81 |
| Migraciones | `git ls-tree -r master --name-only \| grep -c '^supabase/migrations/.*\.sql$'` | 89 |

Se usa siempre `master`, no el árbol de trabajo (da otros valores: 148 de 163 rutas que importan `createAdminClient`). Este conteo mide **importaciones**: no demuestra que cada ruta use efectivamente la `service role` ni es una conclusión de seguridad (`CONCILIACION` P-01).

## 7. Reglas de seguridad documental

1. Los originales no se editan. Lo que cambia se corrige en `CONCILIACION`.
2. Ningún riesgo se presenta como "confirmado en producción" si el campo *Producción* no dice `Verificado`.
3. Commit y push de estos archivos requieren autorización explícita (`CLAUDE.md` §11).
4. Se distingue siempre entre **hallazgo del repositorio** (lo que muestran el código o Git), **prueba ejecutada** (ninguna a esta fecha) y **estado de producción** (no verificado salvo indicación).
