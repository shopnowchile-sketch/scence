-- user_role final: se agregan los dos valores de marca. Va separada porque un valor de enum nuevo no se puede usar en la misma transacción.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'brand_owner';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'brand_member';
