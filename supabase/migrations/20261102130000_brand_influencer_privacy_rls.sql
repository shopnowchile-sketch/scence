-- Regla global de privacidad (2026-11-02): sin catálogo global de influencers para marcas.
-- APLICADA SOLO EN DEV (dexpvoubiklgotuukrml). Producción requiere autorización propia.
--
-- Una marca (owner o miembro) solo lee influencers con relación comprobable con ELLA:
--   · postularon / fueron invitadas / participaron en una campaña propia o creada por la marca (cualquier estado);
--   · están en una campaña donde la marca colabora (campaign_brands);
--   · están en su roster (brand_influencers).
-- Super Admin (organization_members.role = 'super_admin', activo) conserva acceso global. La influencer lee su fila.
-- Mismo criterio que src/lib/brand-influencer-scope.ts (las rutas usan service role; esto protege las llamadas
-- directas a PostgREST con el JWT de un usuario).
--
-- Escrituras: las rutas usan service role. Se retiran las políticas de escritura y los privilegios INSERT/UPDATE/DELETE
-- de authenticated sobre influencers y campaign_influencers (antes un miembro de marca podía, vía PostgREST directo,
-- insertar en campaign_influencers una influencer arbitraria y así "fabricar" una relación).
-- Reversión: recrear influencers_member_read/_write (20261022170000) y campaign_influencers_self_read (ALL, public),
-- `grant insert, update, delete` a authenticated y `drop function` de las tres funciones.

create or replace function public.is_platform_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid() and om.is_active = true and om.role = 'super_admin'
  );
$$;

-- Marcas a las que pertenece el usuario (misma resolución que resolveBrandAccess: org activa, rol de marca,
-- y brand_id explícito cuando la membresía lo trae).
create or replace function public.current_user_brand_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id
  from public.organization_members om
  join public.brands b on b.organization_id = om.organization_id
  where om.user_id = auth.uid()
    and om.is_active = true
    and om.role in ('brand_manager', 'member')
    and (om.brand_id is null or om.brand_id = b.id);
$$;

create or replace function public.can_view_campaign_participants(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_super_admin()
    or exists (
      select 1 from public.campaigns c
      where c.id = p_campaign_id
        and (c.brand_id in (select public.current_user_brand_ids())
          or c.created_by_brand_id in (select public.current_user_brand_ids()))
    )
    or exists (
      select 1 from public.campaign_brands cb
      where cb.campaign_id = p_campaign_id
        and cb.brand_id in (select public.current_user_brand_ids())
    );
$$;

create or replace function public.can_view_influencer(p_influencer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_super_admin()
    or exists (select 1 from public.influencers i where i.id = p_influencer_id and i.user_id = auth.uid())
    or exists (
      select 1 from public.brand_influencers bi
      where bi.influencer_id = p_influencer_id
        and bi.brand_id in (select public.current_user_brand_ids())
    )
    or exists (
      select 1 from public.campaign_influencers ci
      where ci.influencer_id = p_influencer_id
        and public.can_view_campaign_participants(ci.campaign_id)
    );
$$;

revoke all on function public.is_platform_super_admin() from public, anon;
revoke all on function public.current_user_brand_ids() from public, anon;
revoke all on function public.can_view_campaign_participants(uuid) from public, anon;
revoke all on function public.can_view_influencer(uuid) from public, anon;
grant execute on function public.is_platform_super_admin() to authenticated;
grant execute on function public.current_user_brand_ids() to authenticated;
grant execute on function public.can_view_campaign_participants(uuid) to authenticated;
grant execute on function public.can_view_influencer(uuid) to authenticated;

-- influencers: solo lectura por relación.
drop policy if exists influencers_member_read on public.influencers;
drop policy if exists influencers_member_write on public.influencers;
drop policy if exists influencers_related_read on public.influencers;
create policy influencers_related_read on public.influencers
  for select to authenticated
  using (public.can_view_influencer(id));

-- campaign_influencers: la influencer ve lo suyo; la marca, las participaciones de campañas propias/creadas/colaboradas.
drop policy if exists campaign_influencers_self_read on public.campaign_influencers;
drop policy if exists campaign_influencers_related_read on public.campaign_influencers;
create policy campaign_influencers_related_read on public.campaign_influencers
  for select to authenticated
  using (
    influencer_id in (select i.id from public.influencers i where i.user_id = auth.uid())
    or public.can_view_campaign_participants(campaign_id)
  );

revoke insert, update, delete, truncate, trigger, references on public.influencers from anon, authenticated;
revoke insert, update, delete, truncate, trigger, references on public.campaign_influencers from anon, authenticated;
-- anon conserva SELECT (sin política = 0 filas): otras políticas subconsultan estas tablas y fallarían con
-- «permission denied» en vez de vacío (mismo criterio que 20261022170000).
