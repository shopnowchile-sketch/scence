-- M5 (2026-10-23): marcas colaboradoras persistentes, DIRECCIONALES.
--
-- Una fila = "la marca A agregó a la marca B como colaboradora". No crea la
-- relación inversa, no es una jerarquía comercial y NO otorga acceso a nada:
-- ni campañas, ni influencers, ni membresías, ni datos privados de B.
--
-- NO reutiliza campaign_brands: esa tabla exige campaign_id y sus filas dan
-- acceso (RLS de campaigns / campaign_deliverables vía user_can_access_brand).
-- Tampoco se hace backfill desde campaign_brands: colaborar en una campaña no
-- implica una relación permanente.
--
-- RLS habilitado SIN políticas y sin privilegios para anon/authenticated (mismo
-- patrón que campaign_brand_collaborations): solo las rutas con service role,
-- que validan rol y estado de la marca, leen o escriben. No amplía visibilidad.
--
-- GRANT mínimo a service_role (SELECT, INSERT, DELETE: lo único que usa la ruta).
-- Es necesario: los privilegios por defecto de las tablas creadas por `postgres`
-- en public dan a service_role solo Dxtm (sin SELECT/INSERT/DELETE), y sin el
-- GRANT cada llamada fallaría con «permission denied» (comprobado en el catálogo
-- de la rama de pruebas; ver migración campaign_locations_grant_service_role).
--
-- Idempotencia / concurrencia: UNIQUE (brand_id, collaborator_brand_id); la ruta
-- trata el 23505 como "ya existía".
-- Reversión: drop table public.brand_collaborators;

create table if not exists public.brand_collaborators (
  id                    uuid primary key default gen_random_uuid(),
  brand_id              uuid not null,
  collaborator_brand_id uuid not null,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  constraint brand_collaborators_brand_id_fkey
    foreign key (brand_id) references public.brands(id) on delete cascade,
  constraint brand_collaborators_collaborator_brand_id_fkey
    foreign key (collaborator_brand_id) references public.brands(id) on delete cascade,
  constraint brand_collaborators_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null,
  constraint brand_collaborators_pair_key unique (brand_id, collaborator_brand_id),
  constraint brand_collaborators_not_self check (brand_id <> collaborator_brand_id)
);

create index if not exists brand_collaborators_collaborator_idx
  on public.brand_collaborators (collaborator_brand_id);

alter table public.brand_collaborators enable row level security;
revoke all on table public.brand_collaborators from public, anon, authenticated;
grant select, insert, delete on table public.brand_collaborators to service_role;
