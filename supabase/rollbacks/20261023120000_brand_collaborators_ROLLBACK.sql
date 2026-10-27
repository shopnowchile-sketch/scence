-- Reversión de 20261023120000_brand_collaborators.sql.
-- Antes: confirmar que la tabla no tiene datos que deban conservarse (select count(*) from public.brand_collaborators).
drop table if exists public.brand_collaborators;
