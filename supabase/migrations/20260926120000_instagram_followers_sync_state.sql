-- Sincronización de followers de Instagram (auditoría 2026-09-25, doc 07).
-- Fuente: Meta Business Discovery vía lib/instagram/followers-sync.ts, que es
-- el ÚNICO escritor de influencer_social_profiles.followers para platform='instagram'.
-- Migración aditiva: no modifica ni borra datos existentes.

alter table public.influencer_social_profiles
  add column if not exists sync_status text not null default 'pending',
  add column if not exists sync_error text,
  add column if not exists sync_attempted_at timestamptz,
  add column if not exists sync_locked_until timestamptz;

alter table public.influencer_social_profiles
  drop constraint if exists influencer_social_profiles_sync_status_check;
alter table public.influencer_social_profiles
  add constraint influencer_social_profiles_sync_status_check
  check (sync_status in ('ok', 'pending', 'not_found', 'rate_limited', 'auth_error', 'api_error'));

-- Estado inicial honesto: lo que alguna vez se sincronizó queda 'ok' (con su
-- synced_at real, que la UI usa para mostrar la antigüedad); el resto 'pending'.
-- El trigger de updated_at se desactiva solo durante el backfill para no
-- "tocar" 2.000+ filas que no cambiaron de verdad.
alter table public.influencer_social_profiles disable trigger trg_updated_at;
update public.influencer_social_profiles
   set sync_status = 'ok'
 where platform = 'instagram' and synced_at is not null;
alter table public.influencer_social_profiles enable trigger trg_updated_at;

-- Cola del lote: nunca intentados primero, luego los más antiguos.
create index if not exists influencer_social_profiles_ig_sync_queue_idx
  on public.influencer_social_profiles (sync_attempted_at nulls first, synced_at nulls first)
  where platform = 'instagram';

comment on column public.influencer_social_profiles.sync_status is
  'Estado de la última sincronización de followers (solo instagram): ok | pending | not_found | rate_limited | auth_error | api_error';
comment on column public.influencer_social_profiles.sync_locked_until is
  'Lock de concurrencia: evita que cron, admin y cambios de @ sincronicen el mismo perfil a la vez';
