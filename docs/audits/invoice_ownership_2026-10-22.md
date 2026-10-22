# Auditoría: propiedad y aislamiento de facturas (2026-10-22)

Rama: `fix/invoice-brand-ownership-2026-10-22` (sin commits). Migración NO aplicada.

## Causa raíz
- La propiedad se infería solo de `organization_id`; las facturas de marca se creaban en la org de la agencia, por lo que la marca nunca las veía.
- RLS en producción (`FOR ALL` por membresía de org, versionadas en `20260527000001_auth_hooks.sql`) + grants amplios permitían lectura/escritura directa vía PostgREST.
- `invoices.brand_id` = marca receptora/pagadora, con semántica inconsistente. No es propietaria.

## Datos (agregados, solo lectura, sin datos personales)
10 facturas, todas en la org de la agencia; 6 con `brand_id` nulo; 4 con `brand_id` en otra org (2 en conflicto con la marca de la campaña). Ninguna con propietario: quedan accesibles solo para Admin hasta decisión explícita.

## Solución
`invoices.owner_brand_id` (inmutable, NULL = SCENCE/histórica) + `invoice_shares` (solo lectura, RLS sin políticas, solo service_role) + `decideInvoiceAccess` (función pura) + `authorizeInvoice` en todas las rutas. 404 sin acceso, 403 con lectura sin permiso de acción.

## Validación
- Tests de módulo: 69/69 (invoice-* + requirements-*). Suite completa: 396/396. tsc: 0. `git diff --check`: 0.
- Mutaciones (3) detectadas por los tests.
- SQL validado solo en PGlite 0.2.17 (Postgres aislado en memoria, esquema sintético): 24 PASS / 0 FAIL, idempotente. Limitación: no contra la BD real.
- No ejecutado: `next build`, verificación en Preview/UI, aplicación de migración.
