-- Geography hierarchy is now represented by parent_id/level/name.
-- city/country duplicate columns on locations were not used by the live location
-- tree or API; place address remains in locations.address.
alter table public.locations drop column if exists city;
alter table public.locations drop column if exists country;
