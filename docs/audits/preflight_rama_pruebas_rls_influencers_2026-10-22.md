# Preflight — validar `20261022170000_restrict_influencers_rls.sql` en una rama de pruebas (NO ejecutado)

Verificado en SOLO LECTURA el 2026-10-22. No se aplicó nada.

## Proyecto y ramas (Supabase `list_branches` del proyecto padre `xzzbishzfyovrladcaeb` = PRODUCCIÓN, rama `main`, `is_default: true`)
| Rama | project_ref | Estado | Datos | Candidata |
|---|---|---|---|---|
| `campaign-locations-test` | `dexpvoubiklgotuukrml` | MIGRATIONS_FAILED, no persistente | 152 fichas, 0 sin organización | **Sí** (paridad dev 20261021 aplicada) |
| `rebuild-validation-20261010` | `slflkyynhadmnvbbucag` | MIGRATIONS_FAILED, no persistente | no medido; 18 migraciones, sin `dev_parity` | No (más antigua) |

`is_default=false` y `parent_project_ref=xzzbishzfyovrladcaeb` confirman que `dexpvoubiklgotuukrml` NO es producción. Aun así ambas ramas figuran `MIGRATIONS_FAILED`: antes de aplicar hay que decidir si se usa tal cual o se resetea.

## Estado de la rama candidata (`dexpvoubiklgotuukrml`)
- Estado idéntico al de producción para `influencers`: política única `influencers_org_read` (ALL, {public}); RLS activada; `anon`, `authenticated` y `service_role` con 7 privilegios; 11 políticas que mencionan `influencers`.
- Migraciones: 30 aplicadas, la última `20261022165108_register_brand_atomic_owner_flow`. **Hallazgo:** ya contiene `register_brand_atomic` (`20261022164527`) y `..._owner_flow` (`20261022165108`) con versiones DISTINTAS a las del repo (`20261022160000`). No es copia limpia del repo; la migración RLS es independiente de ellas, pero un reintento de `160000` en esa rama requiere revisar el contenido aplicado.
- La rama no está sincronizada con el historial del repo (versiones con otros timestamps): no usar `merge_branch` ni «db push» desde ella hacia producción.

## Pasos propuestos (cada uno requiere tu confirmación explícita)
1. Confirmar la rama (`dexpvoubiklgotuukrml` o una rama nueva desde `main` con datos de prueba).
2. Reconfirmar con `list_branches` que `is_default=false` y con `select current_database()` / `list_migrations` el estado, inmediatamente antes de aplicar.
3. Aplicar SOLO el contenido de `20261022170000_restrict_influencers_rls.sql` con `apply_migration` sobre ESA rama.
4. Verificaciones posteriores (solo lectura): `pg_policies` de `influencers` = 2 políticas; `has_table_privilege` de anon sin INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES y con SELECT; las 10 tablas dependientes consultadas con rol anon sin error; contar fichas visibles para un JWT de prueba.
5. Reversión en la rama: recrear `influencers_org_read` (definición en `20260527000001_auth_hooks.sql`) y `grant insert, update, delete, truncate, trigger, references on public.influencers to anon; grant truncate, trigger, references ... to authenticated;`.

## Límite
Las pruebas de la rama no sustituyen a las locales (113+8 comprobaciones) ni son producción: producción solo se toca con aprobación separada y después de este resultado.
