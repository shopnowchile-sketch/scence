-- Influencer: una ficha con historial de facturación no se puede borrar físicamente.
--
-- Incidente 2026-10-04 (Tiare Valdebenito): un borrado masivo de admin eliminó
-- la ficha de una influencer que había pagado Pro el 29-09. La suscripción
-- (subscriptions.metadata->>'influencer_id', JSON sin FK) quedó apuntando a un
-- id inexistente, el pago perdió su vínculo (FK SET NULL) y la postulación se
-- borró en cascada. Al volver a entrar se le creó una ficha nueva: pagó y quedó Free.
--
-- La app ya bloquea estos borrados (assertNoProInfluencers en
-- lib/influencers/hardDelete.ts), pero 148 de 154 rutas usan la service role
-- key: esta es la última barrera, para cualquier ruta presente o futura.
--
-- Bloquea si la ficha tiene:
--   · una suscripción que no sea un checkout abandonado (status <> 'incomplete'),
--     es decir active / trialing / past_due / canceled (vigente o no), o
--   · cualquier pago registrado en subscription_payments.
-- No crea tablas. Desactivar (is_active = false) sigue permitido.

create or replace function public.prevent_delete_influencer_with_billing()
returns trigger
language plpgsql
-- security definer: el chequeo ve TODAS las suscripciones/pagos aunque quien
-- borre esté sujeto a RLS (si no, una fila invisible permitiría el borrado).
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.subscriptions s
    where s.metadata->>'influencer_id' = old.id::text
      and s.status <> 'incomplete'
  ) or exists (
    select 1 from public.subscription_payments p
    where p.influencer_id = old.id
  ) then
    raise exception 'INFLUENCER_HAS_BILLING_HISTORY: la influencer % tiene suscripción o pagos; desactívala en vez de borrarla', old.id
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists influencers_prevent_delete_with_billing on public.influencers;
create trigger influencers_prevent_delete_with_billing
  before delete on public.influencers
  for each row execute function public.prevent_delete_influencer_with_billing();

revoke all on function public.prevent_delete_influencer_with_billing() from public, anon, authenticated;
