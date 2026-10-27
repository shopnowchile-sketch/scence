# Plan de validación en entorno de prueba — propiedad de facturas (2026-10-22)

Estado: PREPARADO, NO EJECUTADO. La migración `20261022120000_invoice_ownership_and_sharing.sql` no se ha aplicado en ninguna base. Commits locales: `03ae4b5`, `5a58506` (sin push).

## 1. Verificación de solo lectura en producción (2026-10-22, catálogos únicamente)
Coincide con lo que asume la migración:
- RLS activo (no forzado) en `invoices` e `invoice_line_items`.
- Políticas `invoices_org_read` e `invoice_items_org_read`: `ALL`, rol `public` (las de `20260527000001_auth_hooks.sql`). No existe `invoice_shares` ni `owner_brand_id`.
- `anon` y `authenticated` tienen INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER sobre ambas tablas. La migración los revoca.
- Migraciones aplicadas en producción: la última es `20261010184627`. Faltan por aplicar en producción las ya versionadas `20261012230000_crm_email_attachments` y `20261021120000_requirements_atomic_operations`; esta migración (`20261022120000`) iría después de ellas. Decisión pendiente: aplicarlas juntas o por separado.

## 2. Entorno de prueba requerido (no disponible hoy)
No hay Docker ni Supabase CLI local, y CLAUDE.md §18 prohíbe instalarlos como requisito. Opciones, a decidir por la fundadora (la rama de Supabase tiene costo y es remota, requiere autorización):
- A. Rama de Supabase (branch) del proyecto, con datos sintéticos.
- B. Proyecto de pruebas aislado ya existente, si lo hay.
Hasta entonces solo existe la validación en PGlite (24 PASS / 0 FAIL, esquema sintético).

## 3. Pruebas a ejecutar en la base aislada (con datos sintéticos, nunca reales)
1. Aplicar la migración; reaplicarla (idempotencia).
2. `authenticated` no puede INSERT/UPDATE/DELETE en `invoices` ni `invoice_line_items`; `anon` no lee.
3. Miembro de organización no admin no lee `invoices` directo; `super_admin` sí.
4. `service_role` conserva acceso total (las rutas).
5. `owner_brand_id` no se puede cambiar una vez asignado; NULL → valor solo una vez.
6. `invoice_shares`: sin acceso directo para `authenticated`; no se puede compartir con la marca propietaria.
7. Rutas contra esa base: marca A no ve ni modifica facturas de B; compartida = solo lectura; revocar bloquea; facturas con `owner_brand_id` NULL (propiedad de SCENCE) solo para admin.
8. Revisar `get_advisors` (seguridad) tras aplicar.

## 4. Antes de considerar producción
- Resultado de la sección 3 documentado (PASS/FAIL real).
- `npm run build` ya confirmado por la fundadora (396/396, 154/154).
- Re-verificar políticas y grants de producción justo antes de aplicar (pudo haber drift).
- Autorización explícita para aplicar la migración en producción.

## 5. Pendiente de producto
Interfaz para compartir/revocar y pestaña de facturas compartidas (registrado en BRAND-010, gaps). Requiere requerimiento propio.
