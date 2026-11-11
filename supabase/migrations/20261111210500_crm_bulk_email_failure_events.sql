-- Recupera el último rechazo definitivo por contacto que solo se guardaba en el historial.
-- Los intentos inciertos tienen su propio tipo de evento y quedan fuera.
insert into public.crm_email_events (lead_id, event_type, occurred_at, raw_payload)
select a.lead_id, 'email.failed', max(a.created_at),
       jsonb_build_object('source', 'bulk-send-activity')
from public.crm_lead_activities a
where a.action_type = 'email_sent'
  and a.description like 'Envío masivo falló a %'
  and not exists (
    select 1 from public.crm_email_events e
    where e.lead_id = a.lead_id and e.event_type = 'email.failed'
  )
group by a.lead_id;
