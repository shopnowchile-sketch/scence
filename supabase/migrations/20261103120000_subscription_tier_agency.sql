-- Impulso Consulting (agencia multimarca): plan mensual propio de cada marca.
-- Solo agrega el valor al enum; la fila del plan va en la migración siguiente
-- (un valor nuevo de enum no se puede usar en la misma transacción que lo crea).
alter type public.subscription_tier add value if not exists 'agency';
