-- Final removal of legacy influencer geography.
-- Canonical source: influencers.location_id -> locations.
-- Production backup: ops.backup_influencers_legacy_geography_20261005

-- handle_new_user must be canonical-only before the legacy columns are removed.
-- The deployed function is defined by migration 20261005170000_remove_legacy_commune_signup_write.sql.

ALTER TABLE public.influencers
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS commune;
