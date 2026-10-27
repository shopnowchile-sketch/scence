-- Reversión de 20261022160000_register_brand_atomic.sql.
-- No toca datos: las marcas ya creadas con registration_key conservan ese campo en metadata (inofensivo).
-- Antes de revertir, el código que llama a register_brand (src/lib/supabase/registerBrand.ts) debe estar fuera de producción.
drop function if exists public.register_brand(jsonb, uuid, text, uuid, jsonb);
drop index if exists public.brands_registration_key_unique;
