# Guía de documentación — SCENCE

Actualizada: 2026-10-29. Índice vigente; no duplica reglas ni resultados.

## Fuente única por responsabilidad

| Información | Fuente mantenida |
|---|---|
| Reglas de producto, permisos y flujo LOCAL → DEV (`staging`) → PROD (`master`) | [CLAUDE.md](../../CLAUDE.md) |
| Instalación, entornos y comandos de validación | [SETUP.md](../../SETUP.md) |
| Requerimientos y comportamiento funcional | [FUNCTIONAL_DESIGN.md](../FUNCTIONAL_DESIGN.md); el piloto versionado DASH-001 vive en `requirements`, `requirement_versions` y sus evidencias, vía `/admin-requirements` |
| Arquitectura y responsabilidades del código | [SOLUTION_DESIGN.md](../SOLUTION_DESIGN.md) |
| Modelo de datos | [DATA_DESIGN.md](../DATA_DESIGN.md); migraciones versionadas en `supabase/migrations/`, aplicación real por verificar en cada entorno |
| KPI y reportes | [REPORT_DESIGN.md](../REPORT_DESIGN.md), con referencias a los helpers y pruebas ejecutables |
| Pendientes de implementación y validación | [IMPLEMENTATION_ROADMAP.md](../IMPLEMENTATION_ROADMAP.md) |
| Riesgos identificados | [RIESGOS-Y-TAREAS](RIESGOS-Y-TAREAS_v1.0_2026-10-19.csv) |
| Resultado de auditoría | [RESUMEN-EJECUTIVO](RESUMEN-EJECUTIVO_v1.0_2026-10-19.md) |

`SCENCE_FDD_v2.2.md` se conserva como referencia histórica. No mantener reglas activas en dos FDD. Auditorías fechadas, conciliaciones, fichas y clasificaciones de ramas describen el momento de su emisión; no son instrucciones para crear ramas ni evidencia del estado actual.

## Cómo mantener estas fuentes

1. Editar la fuente correspondiente, sin crear otro documento para el mismo propósito.
2. Reglas de negocio: enlazar `CLAUDE.md`; una descripción histórica no cambia permisos ni autoriza implementarlos.
3. Identificar evidencia como código revisado, prueba ejecutada, solo documentado o por verificar. Indicar entorno, fecha y resultado. Simulación no equivale a RLS real.
4. Conservar historial en Git y secciones fechadas. No presentar planes antiguos ni porcentajes estimados como estado actual.
5. `docs/current-state/`, `docs/locations/`, diagramas drawio y varios paquetes enlazados por la guía anterior no están en este checkout: no usarlos como fuentes disponibles ni recrearlos en paralelo.
6. Consultar Git para ramas y commits actuales; `data/ramas_clasificacion_v2.tsv` es una fotografía histórica. No borrar ramas ni worktrees antiguos durante la auditoría.
7. Nunca copiar secretos, claves ni datos personales a documentación o logs.
