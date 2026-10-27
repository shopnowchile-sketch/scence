-- PROPUESTA v2 (NO aplicada; fuera de supabase/migrations a propósito) — 2026-10-22
-- Contenedor comercial de influencers (`influencers.organization_id`) SIN privilegio por nombre ni antigüedad.
--
-- Qué necesita realmente influencers.organization_id (ver docs/audits/diagnostico_influencers_organization_id_2026-10-22.md):
-- es el INQUILINO de los registros comerciales de la influencer (suscripción Pro y pagos, enlaces de afiliado,
-- conversiones, liquidaciones, tickets, campañas propias, bookings, contratos): todas esas tablas tienen
-- organization_id NOT NULL. Con NULL fallan el checkout Pro, los afiliados, los tickets y la ficha de admin.
-- No debe ser la organización de una marca (mezclaría datos comerciales de la influencer con los de esa marca).
--
-- Diseño: una columna explícita y única que la fundadora marca con una sentencia auditada (sin inferirla):
--   1) organizations.influencer_tenant boolean (default false; no cambia ninguna fila existente)
--   2) índice único parcial: como máximo UNA organización marcada
--   3) disparador: una organización marcada no puede alojar marcas nuevas (sigue siendo solo un contenedor)
--   4) handle_new_user: asigna la marcada; sin marcada → NULL y registro OK (ya no existe SCENCE_MAIN_ORG_NOT_FOUND)
-- La marca de designación NO es un privilegio: los permisos siguen saliendo de organization_members.
-- Datos: no se reasigna ni se borra nada. Influencers existentes conservan su organization_id.
-- Reversión: reaplicar handle_new_user de 20261005170000; drop trigger/function/index/column (ver final).

alter table public.organizations add column if not exists influencer_tenant boolean not null default false;
create unique index if not exists organizations_one_influencer_tenant on public.organizations ((true)) where influencer_tenant;

create or replace function public.forbid_brand_in_influencer_tenant()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.organizations o where o.id = new.organization_id and o.influencer_tenant) then
    raise exception 'INFLUENCER_TENANT_CANNOT_HOST_BRANDS';
  end if;
  return new;
end $$;
drop trigger if exists trg_forbid_brand_in_influencer_tenant on public.brands;
create trigger trg_forbid_brand_in_influencer_tenant before insert or update of organization_id on public.brands
  for each row execute function public.forbid_brand_in_influencer_tenant();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_full_name text := coalesce(new.raw_user_meta_data ->> 'full_name', new.email);
  v_role public.user_role := case
    when coalesce((new.raw_user_meta_data ->> 'is_influencer')::boolean, false)
      then 'influencer'::public.user_role
    else 'brand_manager'::public.user_role
  end;
  v_is_self_registration boolean :=
    v_role = 'influencer'::public.user_role
    and nullif(trim(new.raw_user_meta_data ->> 'influencer_id'), '') is null;
  v_display_name text;
  v_instagram_username text;
  v_location_id uuid;
  v_address text;
  v_birth_date date;
  v_tenant_org_id uuid;
  v_influencer_id uuid;
  v_location_level text;
  v_location_active boolean;
begin
  if v_is_self_registration then
    v_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
    v_instagram_username := nullif(trim(new.raw_user_meta_data ->> 'instagram_username'), '');
    v_location_id := nullif(trim(new.raw_user_meta_data ->> 'location_id'), '')::uuid;
    v_address := nullif(trim(new.raw_user_meta_data ->> 'address'), '');

    if v_location_id is null then
      raise exception 'INFLUENCER_SIGNUP_REQUIRED_FIELDS_MISSING';
    end if;

    select l.level, l.is_active
      into v_location_level, v_location_active
    from public.locations l
    where l.id = v_location_id;

    if v_location_level is null or not v_location_active or v_location_level = 'place' then
      raise exception 'INFLUENCER_SIGNUP_INVALID_LOCATION';
    end if;

    if v_display_name is null
      or v_instagram_username is null
      or v_address is null
      or nullif(trim(new.raw_user_meta_data ->> 'birth_date'), '') is null
    then
      raise exception 'INFLUENCER_SIGNUP_REQUIRED_FIELDS_MISSING';
    end if;

    begin
      v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'INFLUENCER_SIGNUP_INVALID_BIRTH_DATE';
    end;

    if v_birth_date >= current_date then
      raise exception 'INFLUENCER_SIGNUP_INVALID_BIRTH_DATE';
    end if;

    v_instagram_username := regexp_replace(v_instagram_username, '^https?://(www\.)?instagram\.com/', '', 'i');
    v_instagram_username := regexp_replace(v_instagram_username, '^(www\.)?instagram\.com/', '', 'i');
    v_instagram_username := regexp_replace(v_instagram_username, '^@+', '');
    v_instagram_username := split_part(split_part(trim(both '/' from v_instagram_username), '/', 1), '?', 1);

    if nullif(trim(v_instagram_username), '') is null then
      raise exception 'INFLUENCER_SIGNUP_INVALID_INSTAGRAM';
    end if;
  end if;

  insert into public.profiles (id, full_name, display_name, role)
  values (new.id, v_full_name, split_part(v_full_name, ' ', 1), v_role)
  on conflict (id) do nothing;

  if v_role = 'influencer'::public.user_role then
    -- Contenedor comercial de influencers: SOLO la organización marcada explícitamente (organizations.influencer_tenant).
    -- No hay búsqueda por nombre ni por antigüedad. Si no hay ninguna marcada, la ficha queda sin organización
    -- (falla segura) en lugar de abortar el registro o inventar una asignación.
    select o.id into v_tenant_org_id from public.organizations o where o.influencer_tenant limit 1;

    select i.id into v_influencer_id
    from public.influencers i
    where i.user_id is null and lower(i.email) = lower(new.email)
    order by i.created_at asc limit 1;

    if v_influencer_id is not null then
      update public.influencers
         set user_id = new.id,
             display_name = case when v_is_self_registration then v_display_name else display_name end,
             location_id = case when v_is_self_registration then v_location_id else location_id end,
             address = case when v_is_self_registration then v_address else address end,
             birth_date = case when v_is_self_registration then v_birth_date else birth_date end,
             organization_id = coalesce(organization_id, v_tenant_org_id),
             metadata = case when v_is_self_registration
               then coalesce(metadata, '{}'::jsonb) || jsonb_build_object('self_registered', true, 'created_by', 'handle_new_user')
               else metadata end
       where id = v_influencer_id;
    else
      insert into public.influencers (
        user_id, email, display_name, location_id, address, birth_date,
        is_active, organization_id, metadata
      )
      values (
        new.id, lower(new.email),
        coalesce(v_display_name, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
        v_location_id, v_address, v_birth_date, true, v_tenant_org_id,
        jsonb_build_object('self_registered', v_is_self_registration, 'created_by', 'handle_new_user')
      )
      returning id into v_influencer_id;
    end if;

    if v_is_self_registration then
      insert into public.influencer_social_profiles (
        influencer_id, platform, username, profile_url, followers, is_primary
      )
      values (
        v_influencer_id, 'instagram'::public.social_platform, v_instagram_username,
        'https://www.instagram.com/' || v_instagram_username, 0, true
      )
      on conflict (influencer_id, platform) do update
        set username = excluded.username,
            profile_url = excluded.profile_url,
            is_primary = true,
            updated_at = now();

      update auth.users
         set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
           - 'instagram_username' - 'location_id' - 'address' - 'birth_date'
       where id = new.id;
    end if;
  end if;

  return new;
end;
$function$;

-- ── DESIGNACIÓN (la ejecuta la fundadora con el id elegido; NO forma parte de la migración) ──
-- update public.organizations set influencer_tenant = true where id = '<ID elegido>';   -- exige que no tenga marcas:
-- select count(*) from public.brands where organization_id = '<ID elegido>';           -- debe ser 0
-- ── REVERSIÓN ──
-- drop trigger trg_forbid_brand_in_influencer_tenant on public.brands; drop function public.forbid_brand_in_influencer_tenant();
-- drop index public.organizations_one_influencer_tenant; alter table public.organizations drop column influencer_tenant;
