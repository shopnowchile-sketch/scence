-- CONSULTA DE SOLO LECTURA — NO EJECUTADA. Requiere autorización explícita de la fundadora.
-- Objetivo: medir fichas de influencers sin organización y cómo se reparten las que sí la tienen.
-- Garantías: una sola sentencia SELECT, sin escrituras, devuelve UNA fila de conteos enteros.
-- No devuelve correos, nombres, ids, tokens ni ningún dato personal (ni siquiera nombres de organizaciones).
-- Ejecución sugerida (sesión de solo lectura): se puede envolver en
--   begin read only; <esta consulta>; rollback;
select
  (select count(*) from public.influencers)                                              as fichas_total,
  (select count(*) from public.influencers where organization_id is null)                as fichas_sin_organizacion,
  (select count(*) from public.influencers where organization_id is null and user_id is not null) as sin_organizacion_con_cuenta,
  (select count(distinct organization_id) from public.influencers where organization_id is not null) as organizaciones_distintas_con_fichas,
  -- reparto de las fichas con organización según lo que contiene esa organización
  (select count(*) from public.influencers i where i.organization_id is not null
     and not exists (select 1 from public.brands b where b.organization_id = i.organization_id))      as fichas_en_org_sin_marca,
  (select count(*) from public.influencers i where i.organization_id is not null
     and (select count(*) from public.brands b where b.organization_id = i.organization_id) = 1)      as fichas_en_org_con_1_marca,
  (select count(*) from public.influencers i where i.organization_id is not null
     and (select count(*) from public.brands b where b.organization_id = i.organization_id) > 1)      as fichas_en_org_con_varias_marcas,
  -- acoplamiento con administración: ¿la organización de la ficha tiene algún super_admin activo?
  (select count(*) from public.influencers i where i.organization_id is not null
     and exists (select 1 from public.organization_members m where m.organization_id = i.organization_id
                 and m.is_active and m.role = 'super_admin'))                                          as fichas_en_org_con_super_admin,
  (select count(*) from public.influencers i where i.organization_id is not null
     and not exists (select 1 from public.organization_members m where m.organization_id = i.organization_id
                 and m.is_active and m.role = 'super_admin'))                                          as fichas_en_org_sin_super_admin,
  -- registros comerciales de influencers (cuántos dependen hoy del organization_id)
  (select count(*) from public.subscription_payments)                                    as pagos_pro,
  (select count(*) from public.affiliate_links where influencer_id is not null)         as enlaces_afiliado,
  (select count(*) from public.commission_settlements)                                    as liquidaciones,
  (select count(*) from public.bookings where influencer_id is not null)                 as bookings,
  (select count(*) from public.contracts where influencer_id is not null)                as contratos,
  -- filas comerciales cuya organización difiere de la de la ficha (si > 0, hay mezcla de inquilinos)
  (select count(*) from public.subscription_payments x join public.influencers i on i.id = x.influencer_id
     where x.organization_id is distinct from i.organization_id)                          as pagos_pro_org_distinta,
  (select count(*) from public.affiliate_links x join public.influencers i on i.id = x.influencer_id
     where x.organization_id is distinct from i.organization_id)                          as enlaces_org_distinta,
  -- homónimos de «scence spa» (solo cuenta; evidencia de la asignación por nombre)
  (select count(*) from public.organizations where type = 'agency' and lower(trim(name)) = 'scence spa') as orgs_llamadas_scence_spa;
