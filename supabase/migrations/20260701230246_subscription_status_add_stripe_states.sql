-- Los estados de Stripe Subscription incluyen incomplete/incomplete_expired/unpaid
-- (ej: primer pago falla) que el enum actual no soporta — el webhook fallaría el
-- insert/update silenciosamente en esos casos. Alta aditiva, sin riesgo (0 filas hoy).
alter type subscription_status add value if not exists 'incomplete';
alter type subscription_status add value if not exists 'incomplete_expired';
alter type subscription_status add value if not exists 'unpaid';;
