-- Documenta la columna `instagram` de public.crm_leads, ya aplicada
-- directamente en producción el 2026-07-09 (prospección vía Instagram).
-- IF NOT EXISTS: no-op seguro si se corre contra la BD de prod donde ya
-- existe; deja alineado cualquier entorno local/staging levantado desde
-- las migraciones del repo.
alter table public.crm_leads
  add column if not exists instagram text;
