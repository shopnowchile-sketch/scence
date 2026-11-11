create or replace function public.crm_email_kpis()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with per_contact as (
    select e.lead_id,
      bool_or(e.event_type = 'email.sent') as sent,
      bool_or(e.event_type = 'email.delivered') as delivered,
      bool_or(e.event_type = 'email.opened') as opened,
      bool_or(e.event_type = 'email.clicked') as clicked,
      bool_or(e.event_type = 'email.failed') as failed,
      bool_or(e.event_type = 'email.bounced') as bounced,
      bool_or(e.event_type in ('email.failed', 'email.bounced', 'email.complained', 'email.suppressed')) as incident
    from public.crm_email_events e
    join public.crm_leads l on l.id = e.lead_id
    where l.qualification_status <> 'converted'
      and e.event_type in ('email.sent', 'email.delivered', 'email.opened', 'email.clicked',
                           'email.failed', 'email.bounced', 'email.complained', 'email.suppressed')
    group by e.lead_id
  )
  select jsonb_build_object(
    'sent', count(*) filter (where sent),
    'delivered', count(*) filter (where delivered),
    'opened', count(*) filter (where opened),
    'clicked', count(*) filter (where clicked),
    'failed', count(*) filter (where failed),
    'bounced', count(*) filter (where bounced),
    'failedOrBounced', count(*) filter (where incident),
    'openRate', round(100.0 * count(*) filter (where delivered and opened)
      / nullif(count(*) filter (where delivered), 0))
  )
  from per_contact;
$$;

revoke all on function public.crm_email_kpis() from public, anon, authenticated;
grant execute on function public.crm_email_kpis() to service_role;
