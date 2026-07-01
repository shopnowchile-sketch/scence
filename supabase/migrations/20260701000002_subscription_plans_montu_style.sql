-- Documenta en el repo el cambio ya aplicado en producción vía Supabase MCP
-- (mismo patrón que 20260701000001_baseline_brands_table.sql: la app usa
-- migraciones de Supabase directamente, este archivo es solo para que el
-- historial del repo quede consistente con el estado real de la BD).
--
-- Contexto: Pri pidió que los planes de suscripción de Marca sean los mismos
-- que "Montu" (3 tiers: Starter/Plus/Enterprise). Se encontraron 2 sistemas
-- de billing ya existentes y desconectados entre sí:
--   1) organizations.stripe_customer_id + subscription_status/subscription_plan,
--      con /api/stripe/checkout|portal|webhook funcionales pero hardcodeados
--      a un solo plan "pro" (src/lib/stripe.ts) — nunca conectado a ninguna UI.
--   2) subscription_plans + subscriptions (multi-tier, desde la migración
--      baseline 2026-05-27) — con 4 planes placeholder, 0 filas en
--      subscriptions, sin API ni UI.
-- Se consolidó todo sobre (2), que ya soportaba multi-tier. (1) se adapta
-- para ser plan-aware en vez de duplicarse.

alter table subscription_plans
  add column if not exists stripe_price_id_monthly text,
  add column if not exists stripe_price_id_yearly  text;

update subscription_plans set
  name = 'Starter', description = 'Para marcas generando entre 5-50 piezas de contenido al mes.',
  price_monthly = 59990, price_yearly = 599900, max_users = 5, max_campaigns = null, max_influencers = null,
  features = '["Campañas ilimitadas","Contenido ilimitado","Gestión de canjes/barters","Reportería de campañas","Hasta 5 usuarios","1 marca"]'::jsonb,
  is_active = true
where tier = 'starter';

update subscription_plans set
  name = 'Plus', description = 'Para empresas multimarca que necesitan segmentar el trabajo.',
  price_monthly = 119990, price_yearly = 1199900, max_users = 10, max_campaigns = null, max_influencers = null,
  features = '["Todo Starter más:","Matchmaker con IA","Invitaciones a campañas","Creadores privados","Hasta 10 usuarios","Hasta 3 marcas"]'::jsonb,
  is_active = true
where tier = 'pro';

update subscription_plans set
  name = 'Enterprise', description = 'Para empresas generando más de 50 videos al mes o con necesidades específicas de desarrollo o facturación.',
  price_monthly = 249990, price_yearly = null, max_users = 15, max_campaigns = null, max_influencers = null,
  features = '["Todo Plus más:","Ejecutivo dedicado","Marca blanca","Pago a 30 días","Hasta 15 marcas","Hasta 15 usuarios"]'::jsonb,
  is_active = true
where tier = 'enterprise';

update subscription_plans set is_active = false where tier = 'growth';
