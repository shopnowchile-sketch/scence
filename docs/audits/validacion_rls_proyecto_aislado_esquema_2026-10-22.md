# Validar la RLS de `influencers` en un proyecto Supabase aislado (volcado SOLO de esquema) — 2026-10-22

Estado: PROCEDIMIENTO, NO ejecutado. Objetivo: probar `20261022170000_restrict_influencers_rls.sql` contra un esquema idéntico al de producción SIN reaplicar el historial de migraciones (que falló en las ramas anteriores) y SIN datos reales.

## Qué se evita
- No usar `create_branch`, `merge_branch`, `supabase db push`, `supabase link` hacia producción ni `supabase db reset`: todos reaplican o sincronizan el historial de migraciones.
- No restaurar datos: `pg_dump --schema-only`. No hay filas de producción en el proyecto de prueba.
- No pegar contraseñas ni cadenas de conexión en el chat ni en archivos del repo: usar variables de entorno locales.

## Prerrequisitos
1. Un proyecto Supabase NUEVO y separado (p. ej. `scence-rls-validation`), misma región (us-east-2) y Postgres 17, creado por ti en el dashboard o autorizando su creación. Nunca reutilizar `xzzbishzfyovrladcaeb` ni sus ramas.
2. `pg_dump`/`psql` versión 17 en tu equipo.
3. Acceso de SOLO LECTURA al esquema de producción: contraseña de la base (dashboard → Database), usada como `PGPASSWORD` en tu terminal; recomendable un rol de solo lectura.
4. Decisión de coste: un proyecto nuevo se factura según tu plan de Supabase (confirmar en Billing; no se estimó aquí). Se elimina al terminar. Una rama equivalente también factura por hora, pero repetiría el historial fallido.

## Pasos
1. Volcado del esquema público de producción (solo lectura sobre producción):
   `pg_dump "$PROD_URL" --schema-only --schema=public --no-owner --file=schema_public_prod.sql`
   (conservar los GRANT/ACL: son parte de lo que se prueba; NO usar `--no-acl`). Revisar el archivo: debe contener CREATE/ALTER/GRANT/POLICY, ningún INSERT/COPY.
2. Sanear solo lo imprescindible para restaurar (referencias a extensiones o a objetos de `auth`/`storage` que ya existen en el proyecto nuevo). Cualquier edición se registra; no se «repara» el historial de migraciones.
3. Restaurar en el proyecto aislado: `psql "$TEST_URL" -v ON_ERROR_STOP=1 -f schema_public_prod.sql`. Si falla, detenerse y documentar el error; no improvisar parches.
4. Comprobar que la línea base es igual a producción (solo lectura en ambos y comparar): `pg_policies` de `influencers` (debe verse `influencers_org_read`), `information_schema.role_table_grants` de `influencers` para anon/authenticated/service_role (7 privilegios) y las 11 políticas que mencionan `influencers`.
5. Cargar datos sintéticos mínimos con un script propio: 2 organizaciones, 2 miembros, 3 fichas (A, B y una sin organización) y filas en las 10 tablas dependientes, como en `scripts/test-rls-influencers-local.mjs`.
6. Aplicar SOLO el SQL de la migración con `psql -f supabase/migrations/20261022170000_restrict_influencers_rls.sql` (sin `apply_migration` ni registro en el historial).
7. Verificar (mismas aserciones del script local, adaptadas): `pg_policies` = 2 políticas `{authenticated}`; `has_table_privilege` de anon sin INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES y con SELECT; con `set local role anon/authenticated` + `request.jwt.claim.sub`: anon 0 filas sin error en influencers y en las 10 dependientes; miembro A ve/escribe solo A; otra organización 0; `service_role` todo.
8. Reversión de prueba: recrear `influencers_org_read` (definición en `20260527000001_auth_hooks.sql`) y devolver los privilegios; confirmar que vuelve a la línea base.
9. Eliminar el proyecto de prueba y borrar el volcado local.

## Límites
Valida RLS y privilegios, no el comportamiento de PostgREST/JWT real de producción ni los datos reales. El resultado de este procedimiento NO autoriza aplicar nada en producción: eso requiere aprobación aparte.
