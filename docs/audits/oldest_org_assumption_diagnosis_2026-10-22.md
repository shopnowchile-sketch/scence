# Diagnóstico: suposición «la organización más antigua es SCENCE» — 2026-10-22

Modelo: organización técnica = una marca. SCENCE es la plataforma; Scence SpA es una marca de prueba sin privilegios. No se crea organización de plataforma ni `SCENCE_PLATFORM_ORG_ID`.

| # | Lugar | Qué hacía | Afecta | Corrección (aplicada en local) |
|---|---|---|---|---|
| 1 | `ensureInfluencerRow` (`src/lib/supabase/ensureOrg.ts`) | Si no existía ficha de influencer, la creaba asignándola a la organización más antigua | **Datos y permisos** (la RLS de influencers se rige por `organization_id`) | Se elimina la creación. Si no hay ficha ni organización verificable: registra error y devuelve `null` (falla segura). El vínculo de fichas huérfanas por `user_id`/Instagram se mantiene. |
| 2 | `GET /api/influencers` (`registered_by`) | Rotulaba «SCENCE» según la organización más antigua | Solo presentación | `src/lib/influencer-registrant.ts`: se deduce de organización → marcas (`brands.organization_id`). Sin marca → «SCENCE»; una marca → su nombre; organización compartida → marca vinculada más antigua en `brand_influencers` o «Marca». |
| 3 | `getOrgId` / `resolveBrandAccess` | Ordenan por antigüedad **las membresías del propio usuario** | Solo desempate determinista, nunca asigna ni concede | Sin cambio. |

## Pendiente de aprobación (no ejecutado)
1. **Trigger `handle_new_user`**: asigna influencers autorregistradas a la organización con `type='agency'` y nombre `scence spa` (privilegio por nombre; lanza `SCENCE_MAIN_ORG_NOT_FOUND`). Requiere migración: dejar `organization_id` NULL (o la marca de origen) y no fallar si no existe.
2. **RLS `influencers_org_read` con `OR organization_id IS NULL`**: cualquier miembro de marca leería fichas sin organización. Revisar junto con el punto 1.
3. **17 rutas con `getOrgId` sin comprobar rol/permiso** (tickets, tickets/[id], brand/brands, locations, affiliates y subrutas, influencers/bulk|communes|duplicates, campaigns/ai-build, events y subrutas): proponer guardas de admin o de permiso de marca.
4. **Riesgo UI**: un admin con varias membresías recibe 409 en `settings/organization` sin `organization_id`.
5. Migraciones `20261022160000_register_brand_atomic` (primero) y `20261022150000_preserve_brand_member_role_sync` (aparte, cambia permisos): no aplicadas en ningún entorno remoto.
