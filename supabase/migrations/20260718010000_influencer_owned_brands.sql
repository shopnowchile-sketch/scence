-- Marcas captadas por influencers: son marcas reales, con organización propia,
-- pero nacen pendientes de aprobación y sin owner/usuario de acceso.
alter table public.brands
  add column if not exists referred_by_influencer_id uuid references public.influencers(id) on delete set null,
  add column if not exists logo_path text;
create index if not exists brands_referred_by_influencer_idx
  on public.brands(referred_by_influencer_id, created_at desc)
  where referred_by_influencer_id is not null;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('influencer-brand-logos', 'influencer-brand-logos', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
