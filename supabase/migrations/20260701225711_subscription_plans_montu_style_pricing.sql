-- Agrega columna para vincular cada plan a un Stripe Price ID real (nullable,
-- se completa cuando Pri cree los Products/Prices en su cuenta de Stripe).
-- No se crea tabla nueva: se reutiliza subscription_plans + subscriptions,
-- que ya existían desde la migración baseline (2026-05-27) pero nunca se
-- habían usado (0 filas en subscriptions, sin UI ni checkout conectado).
alter table subscription_plans
  add column if not exists stripe_price_id_monthly text,
  add column if not exists stripe_price_id_yearly  text;

-- Reestructura los 4 planes placeholder a los 3 tiers estilo Montu pedidos
-- por Pri (mismo nombre/precio/features, adaptado a conceptos de SCENCE).
-- Se reutilizan los tier existentes del enum (starter, pro, enterprise) —
-- 'pro' pasa a mostrarse como "Plus" (evita tener que agregar un valor
-- nuevo al enum subscription_tier). 'growth' se desactiva (Montu solo
-- tiene 3 planes).

update subscription_plans set
  name = 'Starter',
  description = 'Para marcas generando entre 5-50 piezas de contenido al mes.',
  price_monthly = 59990,
  price_yearly = 599900,
  max_users = 5,
  max_campaigns = null,
  max_influencers = null,
  features = '["Campañas ilimitadas","Contenido ilimitado","Gestión de canjes/barters","Reportería de campañas","Hasta 5 usuarios","1 marca"]'::jsonb,
  is_active = true
where tier = 'starter';

update subscription_plans set
  name = 'Plus',
  description = 'Para empresas multimarca que necesitan segmentar el trabajo.',
  price_monthly = 119990,
  price_yearly = 1199900,
  max_users = 10,
  max_campaigns = null,
  max_influencers = null,
  features = '["Todo Starter más:","Matchmaker con IA","Invitaciones a campañas","Creadores privados","Hasta 10 usuarios","Hasta 3 marcas"]'::jsonb,
  is_active = true
where tier = 'pro';

update subscription_plans set
  name = 'Enterprise',
  description = 'Para empresas generando más de 50 videos al mes o con necesidades específicas de desarrollo o facturación.',
  price_monthly = 249990,
  price_yearly = null,
  max_users = 15,
  max_campaigns = null,
  max_influencers = null,
  features = '["Todo Plus más:","Ejecutivo dedicado","Marca blanca","Pago a 30 días","Hasta 15 marcas","Hasta 15 usuarios"]'::jsonb,
  is_active = true
where tier = 'enterprise';

update subscription_plans set is_active = false where tier = 'growth';
;
