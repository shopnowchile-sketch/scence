-- Historical backup tables are no longer part of the SCENCE application.
-- The live schema and current migrations are the source of truth.
drop table if exists public._backup_dedup_influencers;
drop table if exists public._backup_members_cleanup_2026_06_21;
drop table if exists public._backup_orgs_cleanup_2026_06_21;
drop table if exists public._backup_sm_auth_metadata;
drop table if exists public._backup_sm_ghost_orgs;
drop table if exists public._backup_sm_influencers_before;
drop table if exists public._backup_sm_profiles;
drop table if exists public._merge_backup_2026_06_19;
drop table if exists public.influencers_dedup_backup_20260615;
