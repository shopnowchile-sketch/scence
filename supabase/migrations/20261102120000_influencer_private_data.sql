-- RUT de la influencer: dato personal PRIVADO, opcional, editable solo por ella (vía API con sesión).
--
-- Por qué una tabla aparte y no una columna de `influencers`: varias rutas devuelven `select('*')` de
-- influencers (marcas, listados) y la tabla tiene SELECT para anon/authenticated; una columna `rut` ahí se
-- filtraría a quien no corresponde. Esta tabla no tiene privilegios para anon ni authenticated: solo el
-- service role la lee o escribe, y cada ruta decide quién (influencer dueña; admin de plataforma en exportación).
-- Forma canónica "12345678-5" (src/lib/rut.ts). La validez del dígito verificador la comprueba la aplicación.

create table if not exists public.influencer_private_data (
  influencer_id uuid primary key references public.influencers(id) on delete cascade,
  rut text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint influencer_private_data_rut_format check (rut is null or rut ~ '^[0-9]{7,8}-[0-9K]$')
);

alter table public.influencer_private_data enable row level security;

revoke all on public.influencer_private_data from anon, authenticated;
grant select, insert, update on public.influencer_private_data to service_role;

comment on table public.influencer_private_data is
  'Datos personales privados de la influencer (hoy solo RUT). Sin acceso para anon/authenticated; solo service role vía rutas autorizadas.';
