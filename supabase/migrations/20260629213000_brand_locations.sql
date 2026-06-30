create table if not exists public.brand_locations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  address text,
  city text,
  region text,
  country text default 'Chile',
  is_public boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brand_locations_brand_id on public.brand_locations(brand_id);
create index if not exists idx_brand_locations_public on public.brand_locations(is_public);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_brand_locations_updated_at on public.brand_locations;

create trigger trg_brand_locations_updated_at
before update on public.brand_locations
for each row execute function public.set_updated_at();

alter table public.brand_locations enable row level security;

drop policy if exists "brand_locations_service_all" on public.brand_locations;
create policy "brand_locations_service_all"
on public.brand_locations
for all
using (true)
with check (true);
