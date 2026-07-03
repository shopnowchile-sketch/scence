# Respaldo 2026-07-03 — pre/durante fixes de permisos admin-marca

Checkpoint antes de que estos cambios queden 100% probados en producción:
- Fix org-visibility (048c87a, 9f4103f, 7e82e8c, dd5571d, 504b49d, 1efb8e0)
- Notificación automática por email al activar campaña pública
- Permisos admin sobre campañas de marcas con organization_id propio

## Tag de git

`backup-2026-07-03-pre-permissions-fix` apunta al commit `1efb8e0`. Está creado
localmente pero **falta pushearlo** (este entorno no tiene credenciales de
GitHub) — corre:

```bash
cd "/Users/priscillaperez/Claude/Projects/APP SCENCE/scence-app-clean"
git push origin backup-2026-07-03-pre-permissions-fix
```

Para volver a este punto exacto del código en cualquier momento:
```bash
git checkout backup-2026-07-03-pre-permissions-fix
```

## Datos (Supabase)

Snapshot manual (vía SQL, no un pg_dump completo) de las tablas más
relevantes para los cambios de hoy, tomado el 2026-07-03:

- `campaigns.json` — las 11 campañas existentes
- `campaign_brands.json` — las 6 relaciones de marcas colaboradoras
- `organizations.json` — orgs de tipo brand/agency relevantes (no incluye
  las ~30 orgs "'s Org" generadas automáticamente por el trigger de
  signup de influencers — esas no se tocan con estos cambios)
- `organization_members_owners.json` — owners/super_admin por org

**No incluido:** tabla `influencers` (1703 filas) — no fue tocada por estos
cambios y es demasiado grande para un snapshot manual útil.

**Importante:** esto es un respaldo puntual de referencia rápida, no
reemplaza el backup automático de Supabase. Verifica en tu dashboard de
Supabase (Settings → Database → Backups) que el plan tenga backups
diarios / PITR activado para recuperación real ante un desastre.
