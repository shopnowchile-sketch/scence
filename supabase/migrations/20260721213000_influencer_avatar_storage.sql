-- Public profile photos for the influencer directory and campaign reports.
-- Uploads are handled server-side by /api/influencer/avatar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'influencer-avatars',
  'influencer-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
