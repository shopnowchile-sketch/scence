-- Plan mensual de marcas administradas por una agencia (Impulso Consulting).
-- $69.900 CLP al mes por marca; PayPal lo cobra en USD (monto fijado en el plan de PayPal).
-- Una fila por tier: si ya existe, no se toca.
insert into public.subscription_plans (tier, name, description, price_monthly, is_active, features)
select 'agency', 'Agencia · marca', 'Mensualidad por marca administrada por una agencia (campañas ilimitadas durante el mes pagado)', 69900, true,
       '{"unlimited_campaigns": true, "commitment_months": 3}'::jsonb
where not exists (select 1 from public.subscription_plans where tier = 'agency');
