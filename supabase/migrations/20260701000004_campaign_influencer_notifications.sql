-- Tracking de a qué influencers ya se les envió el email de "nueva campaña
-- abierta disponible" para una campaña específica. Sin esto, el botón de
-- notificar (batches de 50, orden por seguidores desc) reenviaría a los
-- mismos top-50 en cada click en vez de avanzar al siguiente batch.
create table if not exists campaign_influencer_notifications (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  influencer_id uuid not null references influencers(id) on delete cascade,
  sent_at       timestamptz not null default now(),
  unique (campaign_id, influencer_id)
);

create index if not exists idx_campaign_influencer_notifications_campaign
  on campaign_influencer_notifications(campaign_id);

alter table campaign_influencer_notifications enable row level security;

-- Solo el service role (admin client, usado en todas las rutas API) necesita
-- acceso — mismo patrón que otras tablas operativas internas. Sin policies
-- para authenticated/anon: nadie debe leer/escribir esto desde el browser.
