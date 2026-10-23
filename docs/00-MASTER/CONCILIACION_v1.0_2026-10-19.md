# Conciliación de la documentación — SCENCE

**Versión:** v1.0 · **Fecha:** 2026-10-19 · **Base:** `master` `ad7f76c` · **Estado:** Propuesta

**Para qué sirve.** Registra qué inconsistencias se resolvieron, con qué evidencia, y cuáles siguen pendientes. Los documentos originales **no se editaron**: lo que aquí se corrige se corrige solo aquí.

**Cómo leer.** Evidencia según `GUIA-DE-DOCUMENTACION_v1.0_2026-10-19.md` §4. Todo se comprobó con lectura (Git de solo lectura, `find`, `shasum`). No se ejecutó ninguna prueba ni build. Nada está verificado en producción. **Distinción:** *hallazgo del repositorio* = lo que muestran el código o Git; *prueba ejecutada* = ninguna; *producción* = no verificada salvo indicación. Rutas completas desde la raíz del repositorio.

---

## A. Resueltas

| ID | Tema | Resolución | Evidencia |
|---|---|---|---|
| C-01 | Cifra de rutas en `master` | Hecho comprobado: **146 de 161** archivos `route.ts` de `master` **importan `createAdminClient`** (método: `git grep -l createAdminClient master -- 'src/app/api/**/route.ts'`). El conteo mide importaciones: no demuestra que cada ruta use efectivamente la `service role` ni es una conclusión de seguridad. Las otras cifras (148/154, 148/163, 163/163) quedan **pendientes** (P-01, P-02). | Código revisado (`git ls-tree`, `git grep`) |
| C-02 | SHA de `master` en `docs/00-MASTER/09-MATRIZ-COMPARATIVA/matriz.csv` | La segunda fila tiene un carácter distinto (`…e44f4f9f…`). Ese objeto **no existe** en Git. El correcto es `ad7f76ccaa243f4e44c4f9f4079f9e9993f8265a`. | Código revisado (`git cat-file`) |
| C-03 | Número de pantallas | **81** en `master`. 36+27+10+8 (README) y 36+27+10+5+3 (funcional) son lo mismo; solo cambia cómo se agrupan "acceso" y "público". | Código revisado |
| C-04 | "Versión" del FDD | `FUNCTIONAL_DESIGN.md` y `SCENCE_FDD_v2.2.md` declaran **ambos versión 2.4** en su cabecera (fechas 2026-07-04 y 2026-07-08). "v2.1" y "v2.2" son solo del nombre de archivo. Los términos Pro son otra numeración (`terms-v2.1`, en `src/lib/influencer-pro-terms.ts`). Cuál es el principal sigue en P-04 (D-01 condicionado; tarea T-08). | Código revisado y cabeceras |
| C-05 | "88 filas" de la matriz | Son **88 grupos de equivalencia**, no 88 ramas. Los totales no cambian: 206 referencias, 145 SHA distintos. | `docs/00-MASTER/09-MATRIZ-COMPARATIVA/matriz.csv` (89 líneas con cabecera) |
| C-06 | Misma rama con clases distintas | La clase es **por SHA**. `crm-limpio` local y remoto tienen SHA distintos (`5a8c430` frente a `8688c9d`): no hay contradicción. Cuatro SHA aparecían en B y en D (`26957d7`, `b400d9b`, `a2b4002`, `4782738`): ahora mandan el contenido (*Con cambios propios*) y el respaldo pasa a ser un rol. Decisión D-02: **aprobada**. | Código revisado (índice maestro) |
| C-07 | Letras repetidas con distinto sentido (clase C/D/E frente a evidencia C/D/E) | Se eliminan las letras. Ver `GUIA` §3 y §4. | — |
| C-08 | Carpetas de respaldo | `docs/00-MASTER/_respaldo-previo-20261019/current-state` es **idéntica** a `docs/current-state` (hash SHA-256 coincide en los 5 archivos). `docs/_respaldos-current-state/20261019-172357` es **otra versión** (su README pesa 7,8 KB frente a 23 KB). Se conservan ambas. | Código revisado (`shasum`) |
| C-09 | 88 frente a 89 migraciones | `docs/audits/migration_drift_2026-10-09.md` cuenta 88 archivos en Git al 2026-10-09. `master` tiene hoy **89**: la 89.ª es `20261010150000_revoke_trigger_function_execute.sql`, con versión posterior a la auditoría. Es consistente; no se comprobó commit a commit. | Código revisado |
| C-10 | "4 ramas modifican el mismo archivo de acceso" (README §6.10) | Medido: **9 SHA distintos** de clase B modifican `src/middleware.ts` frente a `master`, que forman **5 grupos de cambio**: requerimientos (4 SHA, mismo parche), registro de influencer, MercadoPago (2 SHA), catálogo de requerimientos y `login-504`. La cifra "4" no es reproducible. | Código revisado (`git diff --name-only master...SHA`) |
| C-11 | Versión de migración repetida `20261005180000` | El par correcto es `feat/locations-source-of-truth` `a1f0d59` (`campaigns_locations_source_of_truth`) y `fix/data-quality-geography-drilldown` `48adfea` (`drop_legacy_influencer_geography_final`). El Anexo A del README lo asocia a `fix/locations-single-source-reports` (`88270d2`), que usa `20261005130000`–`160000`, no `180000`. Hallazgo del repositorio (ramas); no es un cambio aplicado en producción (producción: no verificado). | Código revisado (`git diff --name-status`) |
| C-12 | TSV frente a índice | Las 206 filas de `docs/00-MASTER/data/ramas_sha_completo.tsv` coinciden con `docs/00-MASTER/00-INDICE-MAESTRO.md` en referencia, SHA y `+adelante/-atrás`. | Código revisado |
| C-13 | Respaldos con contenido propio | La regla de `GUIA` §3 da **10 SHA** (14 referencias) con contenido propio entre los 41 respaldos. Coincide con `docs/00-MASTER/08-RESPALDOS-STASHES/README.md` ("10 con contenido propio"). | Código revisado |
| C-14 | «Las marcas se vinculan a la organización SCENCE» (`FUNCTIONAL_DESIGN.md` BR-10; `SCENCE_FDD_v2.2.md`) | Corregido 2026-10-22: el registro crea una marca en `pending_approval` con su propia organización técnica; SCENCE es la plataforma administradora y SCENCE SpA es una marca de pruebas. Regla en `CLAUDE.md` §16.9; BR-10 y BR-15 en `FUNCTIONAL_DESIGN.md`. `SCENCE_FDD_v2.2.md` queda como histórico con nota. | Código revisado (`register-brand`, `ensureBrandRow`, `PATCH /api/brands/[id]`) y esquema consultado |
| C-15 | «El trigger de signup crea la organización» y «`ensureOrg()` corre en el primer login» (`SOLUTION_DESIGN.md`, `DATA_DESIGN.md`, historial del FDD) | Superado: el trigger no crea organizaciones y `ensureOrg()` es interna (solo `ensureBrandRow()`). Notas de corrección agregadas; el texto original se conserva como histórico. | Código revisado y definición de `handle_new_user` en la base consultada |

## B. Hallazgo nuevo (no estaba en los documentos)

| ID | Hallazgo | Evidencia | Producción |
|---|---|---|---|
| N-01 | **Colisión de versión de migración con `master`.** La rama `fix/dash-001-active-influencers` `1f9127b` (y `feat/requirements-source-of-truth` `cf0fecd`) agrega `20261010150000_requirements_source_of_truth.sql`. `master` ya tiene `20261010150000_revoke_trigger_function_execute.sql`. Dos migraciones con la misma versión. **Hallazgo del repositorio (ramas); no es un cambio aplicado en producción.** | Código revisado (`git diff --name-status`, `git ls-tree`) | No verificado |

## C. Pendientes

| ID | Pendiente | Por qué no se resuelve |
|---|---|---|
| P-01 | Qué cuenta cada cifra de rutas con acceso total a la base: `master` 146/161 **importan `createAdminClient`** (comprobado); árbol de trabajo 148/163 (`find` + `grep`); `CLAUDE.md` §16.2: 148/154 (auditoría 2026-09-05/06); `SOLUTION_DESIGN.md`: 163/163 (2026-10-13) | Los criterios de las tres últimas no están documentados y pueden diferir. **No se concluye nada de seguridad** ni se asume que sean fotos de momentos distintos. Decisión: **pendiente** (definir el método de conteo). |
| P-02 | Origen del 148/154 de `CLAUDE.md` | No se recalculó sobre commits antiguos ni se documentó su método. Se trata como cifra histórica, no como hecho actual. |
| P-03 | Dato "386 usos de service role" | Origen sin método. Con otros métodos da 433 (apariciones) y 242 (llamadas). |
| P-04 | Cuál FDD es el principal (D-01 **condicionado**) | `docs/FUNCTIONAL_DESIGN.md` es el candidato; no se declara definitivo hasta comparar ambos FDD y resolver contradicciones funcionales (tarea **T-08** del CSV). |
| P-05 | Qué carpeta de respaldo es la más reciente | Sin fecha fiable. |
| P-06 | Columnas 6 a 8 de `docs/00-MASTER/data/ramas_sha_completo.tsv` | El archivo no tiene encabezado. En `docs/00-MASTER/data/ramas_B_tema.tsv` aparecen como `ex=` y `un=`. Se conservan **sin interpretar**. |
| P-07 | Equivalencia exacta de respaldos con `ahead > 0` | La regla usa `+/-`; `git cherry` no se volvió a ejecutar en esta etapa. |
| P-08 | Contenido de los 5 stashes y de los 8 `original-local/*` | Solo hay recuento de archivos. Ningún stash se aplicó. |
| P-09 | Estado real en producción: migraciones, RLS de `subscriptions`, 13 marcas Pro, columnas de campañas, envío a ~2.400 influencers, métricas de Instagram | No hay consulta a Supabase ni Vercel. |
| P-10 | Ningún test se ha ejecutado | Esta etapa no ejecuta pruebas. |
| P-11 | Si N-01 está aplicada o no en producción | Por verificar. |
| P-12 | Qué registro representa a SCENCE SpA como marca de pruebas | Sin decidir (la fundadora indicó que no es necesario ahora). Hechos y datos por confirmar: `CLAUDE.md` §16.9 (`Scence` e `Influencers.snc`, aprobadas; hipótesis no comprobadas). No renombrar, fusionar ni borrar. |
| P-13 | Linaje «quién registró una marca» | Auditado: `created_by` es el usuario que ejecutó la creación (autorregistro, admin, influencer o quien añadió una colaboradora); no es relación marca→marca. Solo el flujo de influencer deja vínculo fiable. Plan P6 en `docs/audits/brand_model_hardening_proposal_2026-10-22.md` (requiere aprobación). |
| P-14 | Qué puede hacer una marca según su estado | Regla decidida el 2026-10-22 (ver `CLAUDE.md` §16.9). El servidor aún no la aplica (`resolveBrandAccess` no lee `brands.status`); plan P3 pendiente de aprobación. |
| P-15 | Producción verificada | `xzzbishzfyovrladcaeb` es producción probable por evidencia indirecta; falta confirmar la variable en Vercel. Las cifras de la rama `dexpvoubiklgotuukrml` (73 marcas) no son de producción. |

## D. Qué no se cambió

Código, ramas, stashes, migraciones, documentos existentes, Supabase, Vercel y producción. Las 206 referencias y los 5 stashes siguen intactos. Cualquier corrección de cifras vive solo en este archivo. El archivo derivado `docs/00-MASTER/data/ramas_clasificacion_v2.tsv` agrega una fila de encabezado y 12 columnas; conserva íntegras las 8 columnas y las 206 filas del original.

## E. Actualización 2026-10-22 (solo documental)

Por instrucción de la fundadora se corrigieron `CLAUDE.md` §16.9, `docs/FUNCTIONAL_DESIGN.md`, `docs/SOLUTION_DESIGN.md`, `docs/DATA_DESIGN.md`, `docs/00-MASTER/FICHAS-MODULOS_v1.0_2026-10-19.md` y se anotó `docs/SCENCE_FDD_v2.2.md` como histórico en lo que respecta al modelo de marcas. Los textos antiguos se conservaron con notas fechadas. No se modificaron código, base de datos, migraciones ni producción. Las copias `.docx` y `.pdf` de los FDD no se editaron.

**Segunda actualización 2026-10-22 (solo documental).** Se ajustó el modelo a las reglas de la fundadora (SCENCE única administradora; SCENCE SpA = marca de pruebas; sin privilegios por nombre) y se separaron las cifras por entorno: producción probable (`xzzbishzfyovrladcaeb`: 71 marcas, 61 aprobadas, 10 pendientes) frente a la rama de pruebas (73/63/10, ya no se cita como producción). Detalle en `CLAUDE.md` §16.9 y `docs/audits/identity_multi_role_audit_2026-10-22.md`. Sin cambios de código, base de datos, membresías, configuraciones ni migraciones.

**Tercera actualización 2026-10-22.** Se incorporaron las decisiones de estados, visibilidad de marcas registradas, colaboradoras `pending_approval`, archivado y registro por influencers. Corregido en local (sin commit): comparación exacta de correos/nombres y estado inicial de colaboradoras. Sin cambios en base de datos, RLS, roles, membresías, migraciones ni producción.
