-- Soporte (2026-11-10): plantillas de respuesta para TODOS los tickets, resultado del correo
-- guardado en el historial y un solo ticket abierto de Seguimiento Pro por influencer.
--
-- Transforma lo creado en 20261109120000 (solo aplicado en DEV): ya no hay tipo comercial ni
-- historial aparte; el historial es ticket_replies. Sin envíos automáticos.
-- Reversión: alter table ... rename back / drop de columnas e índice añadidos.

-- 1) Plantillas: una sola tabla, sin tipo ni asunto (el asunto lo pone el correo de soporte).
alter table public.influencer_email_templates rename to support_reply_templates;
alter table public.support_reply_templates drop column if exists kind;
alter table public.support_reply_templates drop column if exists subject;
alter table public.support_reply_templates drop column if exists updated_by;
grant select, insert, update, delete on table public.support_reply_templates to service_role;

delete from public.support_reply_templates;
insert into public.support_reply_templates (key, name, body) values
('general', 'Respuesta general',
 E'Gracias por reportar este problema. Estamos revisándolo y te avisaremos cuando esté solucionado para que puedas probarlo y confirmarnos si todo funciona correctamente. Con tu confirmación podremos cerrar el ticket. ¡Gracias por tu paciencia!'),
('pro_ayuda', 'Ayuda con SCENCE Pro',
 E'Vimos que intentaste activar SCENCE Pro y el proceso no quedó completo. Queremos ayudarte a resolverlo.\n\nPuedes retomar tu activación aquí: {{plan_url}}\n\nSi tuviste algún problema, cuéntanos qué pasó y lo revisamos contigo.'),
('paypal', 'Problema con PayPal',
 E'Si en PayPal aprobaste el pago, no te preocupes: revisaremos tu caso para que no pagues dos veces y tu plan quede activo. Si no estás segura de que el cobro se haya hecho, no vuelvas a pagar todavía: respóndenos este mensaje y lo verificamos primero.');

-- 2) El historial de envíos aparte no se usó nunca (vacío): se elimina.
drop table if exists public.influencer_email_log;

-- 3) Resultado del correo en la respuesta del ticket.
alter table public.ticket_replies add column if not exists email_status text check (email_status in ('sent','failed'));
alter table public.ticket_replies add column if not exists email_error text;

-- 4) Un solo ticket abierto de Seguimiento Pro por influencer (categoría pro_followup).
create unique index if not exists tickets_pro_followup_open_uidx
  on public.tickets (created_by) where category = 'pro_followup' and status <> 'closed' and created_by is not null;
