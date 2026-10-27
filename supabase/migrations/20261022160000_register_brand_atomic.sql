-- P4 (2026-10-22): registro de marca atómico e idempotente.
--
-- Problema: cinco rutas creaban la organización técnica y luego la marca en dos
-- pasos. Si la segunda inserción fallaba, o dos solicitudes competían, quedaban
-- organizaciones sin marca y marcas duplicadas.
--
-- Solución: una única función, ejecutable solo con service_role, que en UNA
-- transacción valida duplicados, crea organización + marca (siempre
-- `pending_approval`) y devuelve el resultado:
--   created   → se creó la marca y su organización.
--   replayed  → la misma solicitud (misma clave de idempotencia o mismo dueño)
--               ya se había procesado; se devuelve la marca existente.
--   conflict  → otra marca ya usa ese correo de contacto o ese Instagram.
-- Las solicitudes simultáneas con el mismo identificador se serializan con
-- advisory locks; un índice único sobre la clave de idempotencia es la red de
-- seguridad final.
--
-- No modifica datos existentes, RLS, roles ni membresías (la membresía del
-- dueño la sigue creando el trigger trg_ensure_brand_owner_org_membership).
-- Reversión: drop function public.register_brand(jsonb, uuid, text, uuid, jsonb);
--            drop index if exists public.brands_registration_key_unique;

create unique index if not exists brands_registration_key_unique
  on public.brands ((metadata->>'registration_key'))
  where (metadata->>'registration_key') is not null;

create or replace function public.register_brand(
  p_brand jsonb,
  p_registered_by uuid,
  p_idempotency_key text default null,
  p_owner_user_id uuid default null,
  p_org jsonb default '{}'::jsonb
)
returns table (out_brand_id uuid, out_organization_id uuid, out_outcome text)
language plpgsql
set search_path = public
as $function$
declare
  v_name text := btrim(coalesce(p_brand->>'name', ''));
  v_email text := nullif(lower(btrim(coalesce(p_brand->>'contact_email', ''))), '');
  v_ig text := nullif(btrim(coalesce(p_brand->>'instagram_handle_normalized', '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_found public.brands%rowtype;
  v_org uuid;
  v_brand uuid;
  v_cols text;
  v_cols_r text;
  v_meta jsonb;
  v_slug_base text;
  v_slug text;
  v_attempt int := 0;
begin
  if v_name = '' then
    raise exception 'register_brand: name is required' using errcode = '22023';
  end if;

  -- Orden fijo de locks (clave → dueño → correo → instagram): evita deadlocks.
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('register_brand:key:' || v_key, 0));
  end if;
  if p_owner_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('register_brand:owner:' || p_owner_user_id::text, 0));
  end if;
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended('register_brand:email:' || v_email, 0));
  end if;
  if v_ig is not null then
    perform pg_advisory_xact_lock(hashtextextended('register_brand:ig:' || v_ig, 0));
  end if;

  -- 1) Reintentos de la misma solicitud.
  if v_key is not null then
    select b.* into v_found from public.brands b where b.metadata->>'registration_key' = v_key limit 1;
    if found then
      return query select v_found.id, v_found.organization_id, 'replayed'::text;
      return;
    end if;
  end if;
  if p_owner_user_id is not null then
    select b.* into v_found from public.brands b where b.user_id = p_owner_user_id limit 1;
    if found then
      return query select v_found.id, v_found.organization_id, 'replayed'::text;
      return;
    end if;
  end if;

  -- 2) Duplicados de otra marca. El autorregistro de un dueño (p_owner_user_id)
  --    se identifica por su usuario, no por el correo de contacto.
  if p_owner_user_id is null and v_email is not null then
    select b.* into v_found from public.brands b where lower(b.contact_email) = v_email limit 1;
    if found then
      return query select v_found.id, v_found.organization_id, 'conflict'::text;
      return;
    end if;
  end if;
  if p_owner_user_id is null and v_ig is not null then
    select b.* into v_found from public.brands b where b.instagram_handle_normalized = v_ig limit 1;
    if found then
      return query select v_found.id, v_found.organization_id, 'conflict'::text;
      return;
    end if;
  end if;

  -- 3) Columnas permitidas desde el cliente (nunca id, estado, dueño, plan ni fechas).
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg('r.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols, v_cols_r
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'brands'
    and c.column_name not in ('id', 'organization_id', 'user_id', 'created_by', 'status',
                              'created_at', 'updated_at', 'subscription_plan_override', 'metadata')
    and p_brand ? c.column_name;

  v_meta := coalesce(p_brand->'metadata', '{}'::jsonb)
            || case when v_key is null then '{}'::jsonb else jsonb_build_object('registration_key', v_key) end;

  v_slug_base := left(coalesce(
    nullif(regexp_replace(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '^-|-$', '', 'g'), ''),
    'org'), 60);

  -- 4) Organización + marca en un único bloque: si algo falla, todo se revierte.
  begin
    loop
      v_attempt := v_attempt + 1;
      v_slug := case when v_attempt = 1 then v_slug_base
                     else left(v_slug_base, 53) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6) end;
      begin
        if p_org ? 'country' then
          insert into public.organizations (name, slug, type, logo_url, country)
          values (v_name, v_slug, 'brand', nullif(p_org->>'logo_url', ''), nullif(p_org->>'country', ''))
          returning id into v_org;
        else
          insert into public.organizations (name, slug, type, logo_url)
          values (v_name, v_slug, 'brand', nullif(p_org->>'logo_url', ''))
          returning id into v_org;
        end if;
        exit;
      exception when unique_violation then
        if v_attempt >= 6 then raise; end if;
      end;
    end loop;

    execute format(
      'insert into public.brands (%s, organization_id, user_id, created_by, status, metadata) '
      || 'select %s, $2, $3, $4, ''pending_approval'', $5 from jsonb_populate_record(null::public.brands, $1) r '
      || 'returning id', v_cols, v_cols_r)
      into v_brand
      using p_brand, v_org, p_owner_user_id, p_registered_by, v_meta;

    return query select v_brand, v_org, 'created'::text;
    return;
  exception when unique_violation then
    -- Una solicitud concurrente ganó la carrera: se revirtió esta organización y
    -- se devuelve el resultado ya existente.
    if v_key is not null then
      select b.* into v_found from public.brands b where b.metadata->>'registration_key' = v_key limit 1;
      if found then
        return query select v_found.id, v_found.organization_id, 'replayed'::text;
        return;
      end if;
    end if;
    if p_owner_user_id is not null then
      select b.* into v_found from public.brands b where b.user_id = p_owner_user_id limit 1;
      if found then
        return query select v_found.id, v_found.organization_id, 'replayed'::text;
        return;
      end if;
    end if;
    if p_owner_user_id is null and v_email is not null then
      select b.* into v_found from public.brands b where lower(b.contact_email) = v_email limit 1;
      if found then
        return query select v_found.id, v_found.organization_id, 'conflict'::text;
        return;
      end if;
    end if;
    if p_owner_user_id is null and v_ig is not null then
      select b.* into v_found from public.brands b where b.instagram_handle_normalized = v_ig limit 1;
      if found then
        return query select v_found.id, v_found.organization_id, 'conflict'::text;
        return;
      end if;
    end if;
    raise;
  end;
end;
$function$;

revoke all on function public.register_brand(jsonb, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.register_brand(jsonb, uuid, text, uuid, jsonb) to service_role;
