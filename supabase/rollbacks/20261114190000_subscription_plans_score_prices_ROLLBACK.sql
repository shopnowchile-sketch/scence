-- Rollback de 20261114190000_subscription_plans_score_prices.
-- Restaura los precios que tenía PRODUCCIÓN el 2026-11-14 (leídos en solo lectura): starter 67.000, growth 267.000.
-- ANTES de aplicar la migración en cada entorno, anotar sus valores reales con:
--   select tier, price_monthly from public.subscription_plans where tier in ('starter', 'growth');
-- y, si difieren de los de abajo (p. ej. en DEV), usar esos valores al revertir.
-- Revertir primero el código que muestra los precios SCORE.
update public.subscription_plans set price_monthly = 67000  where tier = 'starter';
update public.subscription_plans set price_monthly = 267000 where tier = 'growth';
