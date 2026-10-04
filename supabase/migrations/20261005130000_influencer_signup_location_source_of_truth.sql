-- Transition self-registration from free-text commune to canonical locations.
-- Keeps legacy commune support temporarily so production can be deployed safely;
-- the final cleanup migration removes the legacy geography columns after verification.

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
  v_commune text;
  v_location_id uuid;
  v_address text;
  v_birth_date date;
  v_scence_org_id uuid;
  v_influencer_id uuid;
  v_location_level text;
  v_location_active boolean;
begin
  if v_is_self_registration then
    v_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
    v_instagram_username := nullif(trim(new.raw_user_meta_data ->> 'instagram_username'), '');
    v_commune := nullif(trim(new.raw_user_meta_data ->> 'commune'), '');
    v_location_id := nullif(trim(new.raw_user_meta_data ->> 'location_id'), '')::uuid;
    v_address := nullif(trim(new.raw_user_meta_data ->> 'address'), '');

    if v_location_id is null and v_commune is null then
      raise exception 'INFLUENCER_SIGNUP_REQUIRED_FIELDS_MISSING';
    end if;

    if v_location_id is not null then
      select l.level, l.is_active
        into v_location_level, v_location_active
      from public.locations l
      where l.id = v_location_id;

      if v_location_level is null or not v_location_active or v_location_level = 'place' then
        raise exception 'INFLUENCER_SIGNUP_INVALID_LOCATION';
      end if;
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
    select o.id into v_scence_org_id
    from public.organizations o
    where o.type = 'agency' and lower(trim(o.name)) = 'scence spa'
    order by o.created_at asc limit 1;

    if v_scence_org_id is null then
      raise exception 'SCENCE_MAIN_ORG_NOT_FOUND';
    end if;

    select i.id into v_influencer_id
    from public.influencers i
    where i.user_id is null and lower(i.email) = lower(new.email)
    order by i.created_at asc limit 1;

    if v_influencer_id is not null then
      update public.influencers
         set user_id = new.id,
             display_name = case when v_is_self_registration then v_display_name else display_name end,
             location_id = case when v_is_self_registration and v_location_id is not null then v_location_id else location_id end,
             commune = case when v_is_self_registration and v_location_id is null then v_commune else commune end,
             address = case when v_is_self_registration then v_address else address end,
             birth_date = case when v_is_self_registration then v_birth_date else birth_date end,
             organization_id = coalesce(organization_id, v_scence_org_id),
             metadata = case when v_is_self_registration
               then coalesce(metadata, '{}'::jsonb) || jsonb_build_object('self_registered', true, 'created_by', 'handle_new_user')
               else metadata end
       where id = v_influencer_id;
    else
      insert into public.influencers (
        user_id, email, display_name, location_id, commune, address, birth_date,
        is_active, organization_id, metadata
      )
      values (
        new.id, lower(new.email),
        coalesce(v_display_name, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
        v_location_id, case when v_location_id is null then v_commune else null end,
        v_address, v_birth_date, true, v_scence_org_id,
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
           - 'instagram_username' - 'commune' - 'location_id' - 'address' - 'birth_date'
       where id = new.id;
    end if;
  end if;

  return new;
end;
$function$;
