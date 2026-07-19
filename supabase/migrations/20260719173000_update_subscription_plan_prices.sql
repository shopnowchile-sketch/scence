-- Precios mensuales vigentes de SCENCE.
-- El tier histórico "starter" corresponde al plan comercial Starter.

update public.subscription_plans
set name = 'Starter',
    price_monthly = 67000,
    price_yearly = null,
    is_active = true
where tier = 'starter';

update public.subscription_plans
set name = 'Growth',
    price_monthly = 267000,
    price_yearly = null,
    is_active = true
where tier = 'growth';

update public.subscription_plans
set name = 'Pro',
    price_monthly = 697000,
    price_yearly = null,
    is_active = true
where tier = 'pro';
