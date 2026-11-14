-- Precios SCORE (2026-11-14): precio mensual de referencia en CLP, IVA incluido, de los planes de marca a la venta.
--   starter (UI: Pymes)  -> 150.000  (el primer mes a 70.000 lo define el ciclo de entrada del plan en PayPal)
--   growth  (UI: Marcas / Pymes con gestión) -> 250.000
--
-- Solo cambia el precio que MUESTRA la pantalla de planes. No toca `subscriptions`, ni cobros, ni accesos:
-- lo que PayPal cobra lo fija cada plan de PayPal (PAYPAL_*_PLAN_ID), no esta tabla.
-- No se tocan `pro` (lo comparte Influencer Pro y debe seguir activo), `agency` ni `enterprise`.
-- Idempotente: repetirla deja los mismos valores.
update public.subscription_plans set price_monthly = 150000 where tier = 'starter' and price_monthly is distinct from 150000;
update public.subscription_plans set price_monthly = 250000 where tier = 'growth'  and price_monthly is distinct from 250000;
