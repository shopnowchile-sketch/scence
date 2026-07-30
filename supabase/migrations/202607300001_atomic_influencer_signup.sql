-- Previene registros de influencer incompletos.
-- Auth, profile e influencers se crean dentro de la misma transacción.
-- Si no puede resolverse la organización principal, el signup falla de forma
-- explícita en vez de dejar una cuenta invisible en SCENCE.

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
  v_scence_org_id uuid;
begin
  insert into public.profiles (id, full_name, display_name, role)
  values (new.id, v_full_name, split_part(v_full_name, ' ', 1), v_role)
  on conflict (id) do nothing;

  if v_role = 'influencer'::public.user_role then
    select o.id
      into v_scence_org_id
    from public.organizations o
    where o.type = 'agency'
      and lower(trim(o.name)) = 'scence spa'
    order by o.created_at asc
    limit 1;

    if v_scence_org_id is null then
      raise exception 'SCENCE_MAIN_ORG_NOT_FOUND';
    end if;

    -- Un roster importado puede existir antes de que su dueña cree acceso.
    -- Se vincula esa fila primero para no duplicar a la influencer.
    update public.influencers
       set user_id = new.id
     where user_id is null
       and lower(email) = lower(new.email);

    if not exists (
      select 1
      from public.influencers i
      where i.user_id = new.id
    ) then
      insert into public.influencers (
        user_id,
        email,
        display_name,
        is_active,
        organization_id,
        metadata
      )
      values (
        new.id,
        lower(new.email),
        coalesce(
          nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
          nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
          split_part(new.email, '@', 1)
        ),
        true,
        v_scence_org_id,
        jsonb_build_object(
          'self_registered', true,
          'created_by', 'handle_new_user'
        )
      );
    end if;
  end if;

  return new;
end;
$function$;

-- La función se usa mediante el trigger existente on_auth_user_created.
