# Migraciones pendientes, NO aplicadas en ningún entorno remoto del repo — 2026-10-22

## `20261022160000_register_brand_atomic` (aditiva)
- Crea el índice único `brands_registration_key_unique` y la función `register_brand(...)` SECURITY DEFINER (solo `service_role`).
- Dependencias: trigger `trg_ensure_brand_owner_org_membership`; índices únicos de `user_id` e instagram; CHECK de `status`.
- Orden: DEBE ir antes del deploy del código, que falla cerrado con `register_brand_unavailable` si la función no existe.
- Riesgos: el índice único puede fallar si hay duplicados previos (medir antes en solo lectura); función SECURITY DEFINER = revisar `search_path` y grants; la rama `dexpvoubiklgotuukrml` ya tiene versiones distintas aplicadas (ver preflight RLS).
- Reversión: drop de la función y del índice; el código nuevo dejaría de registrar marcas.

## `20261022150000_preserve_brand_member_role_sync` (cambia comportamiento)
- Reemplaza `ensure_brand_member_org_membership`: un `member` permanece `member`; nunca degrada a owner/super_admin. Solo afecta filas futuras.
- Dependencia: `20261004184849`.
- Riesgo: cambia permisos de usuarios nuevos (menos permisivo para `member`); las filas existentes no se corrigen solas.
- Reversión: recrear la versión previa de la función.

## Orden y aprobación
Independientes entre sí y de `20261022170000`. Orden sugerido: 160000 → (deploy código) → 150000 → 170000, cada una con aprobación propia y validación previa en rama de pruebas.
