-- Quita de las descripciones de asistencia la frase que sugería que confirmar requiere aprobación.
update public.campaign_deliverables
set description = btrim(replace(description, 'Una vez aprobada recibirás las indicaciones finales para el evento.', ''))
where type = 'event_attendance' and description like '%Una vez aprobada recibirás las indicaciones finales para el evento.%';

update public.campaigns
set deliverable_templates = replace(deliverable_templates::text, ' Una vez aprobada recibirás las indicaciones finales para el evento.', '')::jsonb
where deliverable_templates::text like '%Una vez aprobada recibirás las indicaciones finales para el evento.%';
