-- Identidad de usuarios, etapa 1 (decisiones 1 y 2 aprobadas en el libro 01 «Identidad de usuarios»).
-- Un dato = un campo = una fuente de verdad:
--   profiles.id          -> profiles.user_id
--   profiles.full_name   -> profiles.user_name   (único nombre visible de toda persona con cuenta)
--   profiles.role        -> profiles.user_role   (super_admin, influencer, brand_owner, brand_member; solo decide el portal)
--   profiles.display_name y influencers.display_name desaparecen. Las influencers SIN cuenta (308 en producción) conservan su nombre
--   en influencers.pending_user_name hasta registrarse: al vincular una cuenta, un disparador lo mueve a profiles.user_name y lo vacía.
--   influencers.user_name es un campo CALCULADO (user_name del usuario o, si no tiene cuenta, pending_user_name); display_name queda como
--   alias CALCULADO TEMPORAL mientras se migran las pantallas y se elimina después.
-- Conserva: nombres públicos y artísticos (en cuentas con cuenta manda el nombre público actual de la ficha), 308 influencers sin cuenta,
-- historial (respaldos en audit_logs: user_identity.backup_*). No toca pagos, suscripciones ni CRM.
-- Requiere la migración 20261113100000 (valores brand_owner / brand_member del enum) ya confirmada.
-- Una sola transacción (apply_migration / db push). lock_timeout de 10 s: si hay una transacción larga, aborta sin cambios.
--
-- REVERSIÓN (probada en DEV): restaura todo desde los respaldos de audit_logs; ver bloque al final del archivo.

SET LOCAL lock_timeout = '10s';
LOCK TABLE public.profiles, public.influencers IN ACCESS EXCLUSIVE MODE;

-- 0) Precondiciones
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.influencers WHERE btrim(coalesce(display_name, '')) = '') THEN
    RAISE EXCEPTION 'Hay influencers con nombre vacío: corregir antes de migrar';
  END IF;
  IF EXISTS (SELECT 1 FROM public.influencers i WHERE i.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.user_id)) THEN
    RAISE EXCEPTION 'Hay influencers con user_id sin perfil';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE btrim(coalesce(full_name, '')) = '') THEN
    RAISE NOTICE 'Hay perfiles con nombre vacío (se conservan tal cual si no son influencers)';
  END IF;
END $$;

-- 1) Respaldos en la auditoría existente (sin tablas nuevas)
INSERT INTO public.audit_logs (entity_type, action, changes)
SELECT 'profiles', 'user_identity.backup_profiles',
       jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('id', id, 'full_name', full_name, 'display_name', display_name, 'role', role::text)), '[]'::jsonb))
FROM public.profiles;
INSERT INTO public.audit_logs (entity_type, action, changes)
SELECT 'influencers', 'user_identity.backup_influencers',
       jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'display_name', display_name)), '[]'::jsonb))
FROM public.influencers;
INSERT INTO public.audit_logs (entity_type, action, changes)
SELECT 'database', 'user_identity.backup_definitions',
       jsonb_build_object(
         'functions', jsonb_build_object(
           'handle_new_user', pg_get_functiondef('public.handle_new_user()'::regprocedure),
           'user_can_access_brand', pg_get_functiondef('public.user_can_access_brand(uuid)'::regprocedure),
           'sync_profile_role', pg_get_functiondef('public.sync_profile_role()'::regprocedure),
           'influencers_set_search_text', pg_get_functiondef('public.influencers_set_search_text()'::regprocedure),
           'locations_refresh_influencer_search', pg_get_functiondef('public.locations_refresh_influencer_search()'::regprocedure)),
         'policies', jsonb_build_object(
           'campaigns_org_read', pg_get_expr(po1.polqual, po1.polrelid),
           'deliverables_org_read', pg_get_expr(po2.polqual, po2.polrelid)))
FROM pg_policy po1, pg_policy po2
WHERE po1.polname = 'campaigns_org_read' AND po1.polrelid = 'public.campaigns'::regclass
  AND po2.polname = 'deliverables_org_read' AND po2.polrelid = 'public.campaign_deliverables'::regclass;

-- 2) Los disparadores que tocarían updated_at o recalcularían el buscador se apagan durante la copia de datos
ALTER TABLE public.profiles DISABLE TRIGGER trg_updated_at;
ALTER TABLE public.influencers DISABLE TRIGGER trg_updated_at;
DROP TRIGGER IF EXISTS trg_influencers_search_text ON public.influencers;

-- 3) Nombre pendiente (solo influencers sin cuenta) y nombre público manda en las cuentas
ALTER TABLE public.influencers ADD COLUMN pending_user_name text;
UPDATE public.influencers SET pending_user_name = display_name WHERE user_id IS NULL;
UPDATE public.profiles p SET full_name = i.display_name
FROM public.influencers i
WHERE i.user_id = p.id AND i.display_name IS DISTINCT FROM p.full_name;

-- 4) Nombres finales
ALTER TABLE public.profiles RENAME COLUMN id TO user_id;
ALTER TABLE public.profiles RENAME COLUMN full_name TO user_name;
ALTER TABLE public.profiles DROP COLUMN display_name;
ALTER TABLE public.influencers DROP COLUMN display_name;
COMMENT ON COLUMN public.profiles.user_name IS 'Único nombre visible de la persona (nombre público o artístico en influencers).';
COMMENT ON COLUMN public.influencers.pending_user_name IS 'Nombre de la influencer mientras NO tiene cuenta; al vincular una cuenta pasa a profiles.user_name y se vacía.';

-- 5) Lectura unificada: campo calculado user_name en influencers (alias display_name temporal)
CREATE OR REPLACE FUNCTION public.influencer_user_name(p_user_id uuid, p_pending text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT pr.user_name FROM public.profiles pr WHERE pr.user_id = p_user_id), p_pending)
$$;
CREATE OR REPLACE FUNCTION public.user_name(i public.influencers)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.influencer_user_name(i.user_id, i.pending_user_name)
$$;
CREATE OR REPLACE FUNCTION public.display_name(i public.influencers)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.influencer_user_name(i.user_id, i.pending_user_name)
$$;
REVOKE ALL ON FUNCTION public.influencer_user_name(uuid, text), public.user_name(public.influencers), public.display_name(public.influencers) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.influencer_user_name(uuid, text), public.user_name(public.influencers), public.display_name(public.influencers) TO authenticated, service_role;

-- 6) Un solo lugar para el nombre: al vincular/escribir con cuenta, el nombre pasa al usuario
CREATE OR REPLACE FUNCTION public.influencers_apply_user_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text;
BEGIN
  IF new.user_id IS NOT NULL AND new.pending_user_name IS NOT NULL THEN
    SELECT p.user_name INTO v_old FROM public.profiles p WHERE p.user_id = new.user_id;
    IF v_old IS DISTINCT FROM new.pending_user_name THEN
      INSERT INTO public.audit_logs (entity_type, entity_id, action, changes)
      VALUES ('profiles', new.user_id, 'user_identity.name_replaced', jsonb_build_object('before', v_old, 'after', new.pending_user_name, 'influencer_id', new.id));
      PERFORM set_config('scence.skip_search_refresh', '1', true);
      UPDATE public.profiles SET user_name = new.pending_user_name WHERE user_id = new.user_id;
      PERFORM set_config('scence.skip_search_refresh', '0', true);
    END IF;
    new.pending_user_name := NULL;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER trg_influencers_apply_user_name BEFORE INSERT OR UPDATE OF pending_user_name, user_id ON public.influencers
  FOR EACH ROW EXECUTE FUNCTION public.influencers_apply_user_name();

-- Buscador (search_text): ahora se arma con el nombre calculado
CREATE OR REPLACE FUNCTION public.influencers_set_search_text()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  new.search_text := btrim(public.search_normalize(public.influencer_user_name(new.user_id, new.pending_user_name)) || ' ' || public.location_search_path(new.location_id));
  return new;
end;
$$;
CREATE TRIGGER trg_influencers_search_text BEFORE INSERT OR UPDATE OF pending_user_name, user_id, location_id ON public.influencers
  FOR EACH ROW EXECUTE FUNCTION public.influencers_set_search_text();

CREATE OR REPLACE FUNCTION public.locations_refresh_influencer_search()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  update public.influencers i
  set search_text = btrim(public.search_normalize(public.influencer_user_name(i.user_id, i.pending_user_name)) || ' ' || public.location_search_path(i.location_id))
  where i.location_id in (
    with recursive down as (
      select id from public.locations where id = new.id
      union all
      select c.id from public.locations c join down on c.parent_id = down.id
    )
    select id from down
  );
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.profiles_refresh_influencer_search()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  IF coalesce(current_setting('scence.skip_search_refresh', true), '0') = '1' THEN RETURN NULL; END IF;
  update public.influencers i
  set search_text = btrim(public.search_normalize(new.user_name) || ' ' || public.location_search_path(i.location_id))
  where i.user_id = new.user_id;
  return null;
end;
$$;
CREATE TRIGGER trg_profiles_user_name_search AFTER UPDATE OF user_name ON public.profiles
  FOR EACH ROW WHEN (old.user_name IS DISTINCT FROM new.user_name) EXECUTE FUNCTION public.profiles_refresh_influencer_search();

-- Si se borra la cuenta, la influencer conserva su nombre en la ficha
CREATE OR REPLACE FUNCTION public.profiles_keep_influencer_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  UPDATE public.influencers SET user_id = NULL, pending_user_name = old.user_name WHERE user_id = old.user_id;
  return old;
end;
$$;
CREATE TRIGGER trg_profiles_keep_influencer_name BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_keep_influencer_name();

-- Invariante: exactamente un lugar para el nombre
ALTER TABLE public.influencers ADD CONSTRAINT influencers_single_user_name
  CHECK ((user_id IS NULL) = (pending_user_name IS NOT NULL));

-- 7) user_role: tipo de cuenta y portal (no da acceso a ninguna marca)
ALTER TABLE public.profiles RENAME COLUMN role TO user_role;
ALTER TABLE public.profiles ALTER COLUMN user_role DROP DEFAULT;
UPDATE public.profiles p SET user_role = CASE
  WHEN EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = p.user_id AND om.is_active AND om.role = 'super_admin') THEN 'super_admin'::public.user_role
  WHEN EXISTS (SELECT 1 FROM public.influencers i WHERE i.user_id = p.user_id) THEN 'influencer'::public.user_role
  WHEN EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = p.user_id AND om.is_active AND om.is_owner) THEN 'brand_owner'::public.user_role
  WHEN EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = p.user_id AND om.is_active) THEN 'brand_member'::public.user_role
  WHEN p.user_role = 'influencer'::public.user_role THEN 'influencer'::public.user_role
  WHEN p.user_role = 'super_admin'::public.user_role THEN 'super_admin'::public.user_role
  ELSE 'brand_member'::public.user_role
END;
ALTER TABLE public.profiles ALTER COLUMN user_role SET DEFAULT 'brand_member'::public.user_role;
DROP TRIGGER IF EXISTS trg_sync_profile_role_ins ON public.organization_members;
DROP TRIGGER IF EXISTS trg_sync_profile_role_upd ON public.organization_members;
DROP TRIGGER IF EXISTS trg_sync_profile_role_del ON public.organization_members;
DROP FUNCTION IF EXISTS public.sync_profile_role();
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_role_final CHECK (user_role IN ('super_admin'::public.user_role, 'influencer'::public.user_role, 'brand_owner'::public.user_role, 'brand_member'::public.user_role));

-- 8) Políticas y funciones que leían profiles.role / profiles.id
ALTER POLICY campaigns_org_read ON public.campaigns USING (
  (EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = campaigns.organization_id AND om.user_id = auth.uid() AND om.is_active = true))
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.user_role IN ('brand_owner'::public.user_role, 'brand_member'::public.user_role)));
ALTER POLICY deliverables_org_read ON public.campaign_deliverables USING (
  (EXISTS (SELECT 1 FROM public.campaigns c JOIN public.organization_members om ON om.organization_id = c.organization_id
           WHERE c.id = campaign_deliverables.campaign_id AND om.user_id = auth.uid() AND om.is_active = true))
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.user_role IN ('brand_owner'::public.user_role, 'brand_member'::public.user_role)));

CREATE OR REPLACE FUNCTION public.user_can_access_brand(target_brand_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.user_role = 'super_admin'::public.user_role)
  OR EXISTS (
    SELECT 1 FROM public.brands b JOIN public.organization_members om ON om.organization_id = b.organization_id
    WHERE b.id = target_brand_id AND om.user_id = auth.uid() AND om.is_active = true)
  -- Compatibilidad temporal para organizaciones aún no backfilleadas.
  OR EXISTS (SELECT 1 FROM public.brands b WHERE b.id = target_brand_id AND b.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = target_brand_id AND bm.user_id = auth.uid() AND bm.is_active = true);
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_full_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''), new.raw_user_meta_data ->> 'full_name', new.email);
  v_role public.user_role := CASE WHEN coalesce((new.raw_user_meta_data ->> 'is_influencer')::boolean, false) THEN 'influencer'::public.user_role ELSE 'brand_member'::public.user_role END;
  v_is_self_registration boolean := v_role = 'influencer'::public.user_role AND nullif(trim(new.raw_user_meta_data ->> 'influencer_id'), '') IS NULL;
  v_display_name text; v_instagram_username text; v_location_id uuid; v_address text; v_birth_date date;
  v_scence_org_id uuid; v_influencer_id uuid; v_location_level text; v_location_active boolean;
  v_existing_name text; v_user_name text;
BEGIN
  IF v_is_self_registration THEN
    v_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
    v_instagram_username := nullif(trim(new.raw_user_meta_data ->> 'instagram_username'), '');
    v_location_id := nullif(trim(new.raw_user_meta_data ->> 'location_id'), '')::uuid;
    v_address := nullif(trim(new.raw_user_meta_data ->> 'address'), '');
    IF v_location_id IS NULL THEN RAISE EXCEPTION 'INFLUENCER_SIGNUP_REQUIRED_FIELDS_MISSING'; END IF;
    SELECT l.level, l.is_active INTO v_location_level, v_location_active FROM public.locations l WHERE l.id = v_location_id;
    IF v_location_level IS NULL OR NOT v_location_active OR v_location_level = 'place' THEN RAISE EXCEPTION 'INFLUENCER_SIGNUP_INVALID_LOCATION'; END IF;
    IF v_display_name IS NULL OR v_instagram_username IS NULL OR v_address IS NULL OR nullif(trim(new.raw_user_meta_data ->> 'birth_date'), '') IS NULL THEN RAISE EXCEPTION 'INFLUENCER_SIGNUP_REQUIRED_FIELDS_MISSING'; END IF;
    BEGIN v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INFLUENCER_SIGNUP_INVALID_BIRTH_DATE'; END;
    IF v_birth_date >= current_date THEN RAISE EXCEPTION 'INFLUENCER_SIGNUP_INVALID_BIRTH_DATE'; END IF;
    v_instagram_username := regexp_replace(v_instagram_username, '^https?://(www\.)?instagram\.com/', '', 'i');
    v_instagram_username := regexp_replace(v_instagram_username, '^(www\.)?instagram\.com/', '', 'i');
    v_instagram_username := regexp_replace(v_instagram_username, '^@+', '');
    v_instagram_username := split_part(split_part(trim(both '/' from v_instagram_username), '/', 1), '?', 1);
    IF nullif(trim(v_instagram_username), '') IS NULL THEN RAISE EXCEPTION 'INFLUENCER_SIGNUP_INVALID_INSTAGRAM'; END IF;
  END IF;

  IF v_role = 'influencer'::public.user_role THEN
    SELECT i.id, i.pending_user_name INTO v_influencer_id, v_existing_name FROM public.influencers i WHERE i.user_id IS NULL AND lower(i.email) = lower(new.email) ORDER BY i.created_at ASC LIMIT 1;
    v_user_name := coalesce(CASE WHEN v_is_self_registration THEN v_display_name ELSE v_existing_name END, v_display_name, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  ELSE
    v_user_name := v_full_name;
  END IF;

  INSERT INTO public.profiles (user_id, user_name, user_role) VALUES (new.id, v_user_name, v_role) ON CONFLICT (user_id) DO NOTHING;

  IF v_role = 'influencer'::public.user_role THEN
    SELECT o.id INTO v_scence_org_id FROM public.organizations o WHERE o.type = 'agency' AND lower(trim(o.name)) = 'scence spa' ORDER BY o.created_at ASC LIMIT 1;
    IF v_scence_org_id IS NULL THEN RAISE EXCEPTION 'SCENCE_MAIN_ORG_NOT_FOUND'; END IF;
    IF v_influencer_id IS NOT NULL THEN
      IF v_is_self_registration AND v_existing_name IS NOT NULL AND v_existing_name IS DISTINCT FROM v_user_name THEN
        INSERT INTO public.audit_logs (entity_type, entity_id, action, changes)
        VALUES ('profiles', new.id, 'user_identity.pending_name_replaced', jsonb_build_object('pending_user_name', v_existing_name, 'user_name', v_user_name, 'influencer_id', v_influencer_id));
      END IF;
      UPDATE public.influencers SET user_id = new.id, pending_user_name = NULL,
        location_id = CASE WHEN v_is_self_registration THEN v_location_id ELSE location_id END,
        address = CASE WHEN v_is_self_registration THEN v_address ELSE address END,
        birth_date = CASE WHEN v_is_self_registration THEN v_birth_date ELSE birth_date END,
        organization_id = coalesce(organization_id, v_scence_org_id),
        metadata = CASE WHEN v_is_self_registration THEN coalesce(metadata, '{}'::jsonb) || jsonb_build_object('self_registered', true, 'created_by', 'handle_new_user') ELSE metadata END
      WHERE id = v_influencer_id;
    ELSE
      INSERT INTO public.influencers (user_id, email, location_id, address, birth_date, is_active, organization_id, metadata)
      VALUES (new.id, lower(new.email), v_location_id, v_address, v_birth_date, true, v_scence_org_id, jsonb_build_object('self_registered', v_is_self_registration, 'created_by', 'handle_new_user'))
      RETURNING id INTO v_influencer_id;
    END IF;
    IF v_is_self_registration THEN
      INSERT INTO public.influencer_social_profiles (influencer_id, platform, username, profile_url, followers, is_primary)
      VALUES (v_influencer_id, 'instagram'::public.social_platform, v_instagram_username, 'https://www.instagram.com/' || v_instagram_username, 0, true)
      ON CONFLICT (influencer_id, platform) DO UPDATE SET username = excluded.username, profile_url = excluded.profile_url, is_primary = true, updated_at = now();
      UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'instagram_username' - 'location_id' - 'address' - 'birth_date' WHERE id = new.id;
    END IF;
  END IF;
  RETURN new;
END;
$function$;

-- 9) Reactivar disparadores y comprobar que no se perdió ningún nombre
ALTER TABLE public.profiles ENABLE TRIGGER trg_updated_at;
ALTER TABLE public.influencers ENABLE TRIGGER trg_updated_at;

DO $$
DECLARE b_inf jsonb; n_lost int; n_total int;
BEGIN
  SELECT changes -> 'rows' INTO b_inf FROM public.audit_logs WHERE action = 'user_identity.backup_influencers' ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO n_total FROM jsonb_to_recordset(b_inf) AS r(id uuid, user_id uuid, display_name text);
  SELECT count(*) INTO n_lost
  FROM jsonb_to_recordset(b_inf) AS r(id uuid, user_id uuid, display_name text)
  JOIN public.influencers i ON i.id = r.id
  WHERE public.influencer_user_name(i.user_id, i.pending_user_name) IS DISTINCT FROM r.display_name;
  IF n_lost > 0 THEN RAISE EXCEPTION 'Se perdieron % nombres públicos de % influencers: se deshace todo', n_lost, n_total; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_name IS NULL) THEN RAISE EXCEPTION 'Hay perfiles sin nombre'; END IF;
  IF EXISTS (SELECT 1 FROM public.influencers WHERE user_id IS NULL AND pending_user_name IS NULL) THEN RAISE EXCEPTION 'Hay influencers sin cuenta y sin nombre'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN (no se ejecuta con la migración). Restaura nombres, columnas, disparadores y funciones desde audit_logs:
--   BEGIN;
--   SET LOCAL lock_timeout='10s'; LOCK TABLE public.profiles, public.influencers IN ACCESS EXCLUSIVE MODE;
--   ALTER TABLE public.profiles DISABLE TRIGGER trg_updated_at; ALTER TABLE public.influencers DISABLE TRIGGER trg_updated_at;
--   ALTER TABLE public.influencers DROP CONSTRAINT influencers_single_user_name;
--   DROP TRIGGER trg_influencers_apply_user_name ON public.influencers; DROP TRIGGER trg_influencers_search_text ON public.influencers;
--   DROP TRIGGER trg_profiles_user_name_search ON public.profiles; DROP TRIGGER trg_profiles_keep_influencer_name ON public.profiles;
--   DROP FUNCTION public.user_name(public.influencers), public.display_name(public.influencers), public.influencer_user_name(uuid,text),
--     public.influencers_apply_user_name(), public.profiles_refresh_influencer_search(), public.profiles_keep_influencer_name();
--   ALTER TABLE public.profiles ALTER COLUMN user_role DROP DEFAULT; ALTER TABLE public.profiles DROP CONSTRAINT profiles_user_role_final;
--   ALTER TABLE public.profiles RENAME COLUMN user_role TO role; ALTER TABLE public.profiles RENAME COLUMN user_name TO full_name;
--   ALTER TABLE public.profiles RENAME COLUMN user_id TO id;
--   ALTER TABLE public.profiles ADD COLUMN display_name text; ALTER TABLE public.influencers ADD COLUMN display_name text;
--   UPDATE public.profiles p SET full_name = r.full_name, display_name = r.display_name, role = r.role::public.user_role
--     FROM jsonb_to_recordset((SELECT changes->'rows' FROM public.audit_logs WHERE action='user_identity.backup_profiles' ORDER BY created_at DESC LIMIT 1)) AS r(id uuid, full_name text, display_name text, role text) WHERE p.id = r.id;
--   UPDATE public.influencers i SET display_name = r.display_name
--     FROM jsonb_to_recordset((SELECT changes->'rows' FROM public.audit_logs WHERE action='user_identity.backup_influencers' ORDER BY created_at DESC LIMIT 1)) AS r(id uuid, user_id uuid, display_name text) WHERE i.id = r.id;
--   ALTER TABLE public.influencers ALTER COLUMN display_name SET NOT NULL; ALTER TABLE public.influencers DROP COLUMN pending_user_name;
--   ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'brand_manager'::public.user_role;
--   -- funciones y políticas anteriores (texto guardado en el respaldo):
--   DO $r$ DECLARE d jsonb; k text; BEGIN SELECT changes INTO d FROM public.audit_logs WHERE action='user_identity.backup_definitions' ORDER BY created_at DESC LIMIT 1;
--     FOR k IN SELECT jsonb_object_keys(d->'functions') LOOP EXECUTE d->'functions'->>k; END LOOP; END $r$;
--   ALTER POLICY campaigns_org_read ON public.campaigns USING (<texto en backup_definitions → policies.campaigns_org_read>);
--   ALTER POLICY deliverables_org_read ON public.campaign_deliverables USING (<texto en backup_definitions → policies.deliverables_org_read>);
--   CREATE TRIGGER trg_influencers_search_text BEFORE INSERT OR UPDATE OF display_name, location_id ON public.influencers FOR EACH ROW EXECUTE FUNCTION public.influencers_set_search_text();
--   CREATE TRIGGER trg_sync_profile_role_ins AFTER INSERT ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role();
--   CREATE TRIGGER trg_sync_profile_role_upd AFTER UPDATE OF role ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role();
--   CREATE TRIGGER trg_sync_profile_role_del AFTER DELETE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role();
--   ALTER TABLE public.profiles ENABLE TRIGGER trg_updated_at; ALTER TABLE public.influencers ENABLE TRIGGER trg_updated_at;
--   COMMIT;
-- (El valor del enum brand_owner / brand_member agregado por 20261113100000 no se puede quitar y es inocuo.)
