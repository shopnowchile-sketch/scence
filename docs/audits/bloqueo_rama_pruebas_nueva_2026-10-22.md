# Rama de pruebas nueva desde `main`: NO creada — bloqueo (2026-10-22)

Verificado en solo lectura. No se creó ninguna rama, no se aplicó ninguna migración.

- Proyecto base: `xzzbishzfyovrladcaeb` (`scence-app`, us-east-2, Postgres 17, organización `tcbmipghxmzzsftmrgbq`), rama `main` = PRODUCCIÓN.
- Método disponible: `create_branch`, que **reaplica todo el historial de migraciones de `main` sobre una base nueva sin datos** (solo se puede ejecutar si se acepta el coste por hora de cómputo; el servidor pide confirmación).
- Evidencia de incompatibilidad: las dos ramas creadas así (`campaign-locations-test`, 2026-10-09, y `rebuild-validation-20261010`, 2026-10-10) terminaron en `MIGRATIONS_FAILED` y solo se pudieron usar tras reconstrucciones manuales (`test_reset_public_schema`, `baseline_p1…p6`, `dev_parity_p1…p5`). El historial de producción incluye migraciones de reconciliación (`baseline_drift_reconcile`, `baseline_brands_table`) y difiere del repo (96 archivos locales; producción no registra, p. ej., `20261005170000_remove_legacy_commune_signup_write`; el repo tiene 6 migraciones posteriores a la última de producción `20261010184627`).
- Conclusión: no puedo garantizar que una rama nueva sea compatible con el esquema actual, y arreglarlo exigiría reparar migraciones, que fue excluido expresamente.
- Impacto de crearla: coste por hora de cómputo de la rama; aislada de producción por diseño (proyecto propio), pero sin datos.
## Alternativas (necesitan tu decisión)
1. Sin rama: la validación local (Postgres desechable, 121 comprobaciones) más una revisión SQL manual, y aplicar en producción solo con tu aprobación explícita, en horario controlado y con reversión preparada.
2. Rama nueva aceptando que puede fallar, y si falla, estudiar la causa sin reparar migraciones.
3. Proyecto Supabase separado cargado con un volcado de solo esquema de producción (pg_dump --schema-only), que es lo más fiel pero requiere acceso de lectura al esquema y tu aprobación de coste.
