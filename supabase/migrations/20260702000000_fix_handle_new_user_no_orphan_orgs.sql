-- FIX (B-18 seguimiento): handle_new_user() creaba una organización nueva y aislada
-- ('{nombre}'s Org', type='agency') en CADA signup (influencer o brand, sin distinguir),
-- más un organization_members owner y un stamp de organization_id huérfano en el
-- metadata del usuario. Resultado: ~60 organizaciones huérfanas acumuladas, ~30
-- nuevas cada 24h mientras el trigger siguió activo.
--
-- Aplicado en producción (xzzbishzfyovrladcaeb) el 2026-07-02. Este archivo documenta
-- el cambio en el repo para que las migraciones no diverjan del schema real.
--
-- Alcance de este fix: SOLO el trigger. No toca:
--   - Las 60 organizaciones huérfanas ya existentes (limpieza aparte, hay dependencias
--     reales: cada una tiene al menos su organization_member owner).
--   - RLS.
--   - El backfill de influencers ya ejecutado (814 UPDATE + 252 INSERT, 2026-07-02).
--   - Frontend: la lógica de aprovisionamiento real de organización ya existe y está
--     probada en producción, y ahora puede correr sin que el trigger la pise primero:
--       Influencer -> ensureInfluencerRow() en (influencer)/layout.tsx, org = Scence SpA
--       Brand      -> ensureOrg() + /api/brand/register en (brand)/layout.tsx
--
-- Mejora incluida: profiles.role ahora refleja el tipo real de cuenta según
-- user_metadata.is_influencer (antes: 'brand_manager' fijo para todos, incluyendo
-- creadores auto-registrados).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_full_name TEXT := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_role public.user_role := CASE
    WHEN COALESCE((NEW.raw_user_meta_data->>'is_influencer')::boolean, FALSE) THEN 'influencer'::public.user_role
    ELSE 'brand_manager'::public.user_role
  END;
BEGIN
  INSERT INTO public.profiles (id, full_name, display_name, role)
  VALUES (NEW.id, v_full_name, split_part(v_full_name, ' ', 1), v_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
