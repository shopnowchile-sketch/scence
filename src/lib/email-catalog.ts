export type EmailAudience = 'influencer' | 'brand' | 'admin' | 'team' | 'customer'
export type EmailUsage = 'automatic' | 'manual' | 'manual_and_automatic'
export type EmailCategory = 'campaigns' | 'attendance' | 'content' | 'access' | 'billing' | 'support' | 'documents' | 'crm' | 'operations'

export type EmailTemplateDefinition = {
  key: string
  name: string
  description: string
  category: EmailCategory
  audience: EmailAudience
  usage: EmailUsage
  contexts: Array<'campaign' | 'crm' | 'system'>
  requiredVariables: string[]
  defaultSubject: string
  defaultMessage?: string
  defaultButtonLabel?: string
  defaultButtonUrl?: string
}

// Registro único de los emails existentes. La persistencia continúa en código:
// contract_templates sigue reservada exclusivamente para documentos/NDA.
export const EMAIL_CATALOG: EmailTemplateDefinition[] = [
  { key: 'password_reset', name: 'Recuperación de contraseña', description: 'Link temporal para crear una nueva contraseña.', category: 'access', audience: 'customer', usage: 'automatic', contexts: ['system'], requiredVariables: ['action_link'], defaultSubject: 'Restablece tu contraseña — Scence' },
  { key: 'brand_signup_confirmation', name: 'Confirmación de registro de marca', description: 'Confirma el registro inicial del portal de marcas.', category: 'access', audience: 'brand', usage: 'automatic', contexts: ['system'], requiredVariables: ['contact_name', 'action_link'], defaultSubject: 'Confirma tu cuenta — SCENCE' },
  { key: 'influencer_campaign_invite', name: 'Invitación privada de influencer', description: 'Invitación generada automáticamente por el flujo privado de campaña.', category: 'campaigns', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'campaign_name', 'brand_name', 'portal_url'], defaultSubject: 'Invitación a {{campaign_name}}' },
  {
    key: 'crm_intro',
    name: 'Introducción comercial CRM',
    description: 'Presentación inicial de SCENCE para prospectos y PYMES.',
    category: 'crm',
    audience: 'brand',
    usage: 'manual_and_automatic',
    contexts: ['crm', 'system'],
    requiredVariables: ['contact_name', 'company_name'],
    defaultSubject: 'Hola, ¿cómo estás?',
    defaultMessage: `Hola {{contact_name}},

Soy Pri, fundadora de SCENCE.

Hoy las marcas ya no crecen solo con publicidad tradicional. Las personas quieren contenido real, recomendaciones auténticas y marcas que les generen confianza.

Por eso creamos SCENCE: una plataforma chilena que conecta marcas con creadoras de contenido e influencers para crear campañas, eventos, canjes y contenido UGC que ayude a aumentar visibilidad, seguidores, confianza y ventas.

Queremos invitar a {{company_name}} a probar SCENCE y crear su primera campaña con creadoras.

Si quieres más información, también me puedes escribir directo a pri@scence.cl.

Saludos,
Pri
SCENCE`,
    defaultButtonLabel: 'Crear mi primera campaña gratis →',
    defaultButtonUrl: 'https://scence-app.vercel.app/register',
  },
  {
    key: 'crm_follow_up',
    name: 'Seguimiento comercial CRM',
    description: 'Seguimiento breve para prospectos contactados anteriormente.',
    category: 'crm',
    audience: 'brand',
    usage: 'manual',
    contexts: ['crm'],
    requiredVariables: ['contact_name', 'company_name'],
    defaultSubject: '¿Conversamos sobre una campaña para {{company_name}}?',
    defaultMessage: `Hola {{contact_name}},

Quería retomar mi mensaje sobre SCENCE. Ayudamos a marcas como {{company_name}} a crear campañas con creadoras de contenido de forma simple y acompañada.

Si te interesa, podemos revisar una primera idea de campaña sin compromiso.

Saludos,
Pri
SCENCE`,
    defaultButtonLabel: 'Conocer SCENCE →',
    defaultButtonUrl: 'https://scence-app.vercel.app/register',
  },
  {
    key: 'crm_clicked_follow_up',
    name: 'Seguimiento después de clic',
    description: 'Mensaje para prospectos que hicieron clic en un email anterior.',
    category: 'crm',
    audience: 'brand',
    usage: 'manual',
    contexts: ['crm'],
    requiredVariables: ['contact_name', 'company_name'],
    defaultSubject: '{{company_name}}, ¿vemos una primera campaña?',
    defaultMessage: `Hola {{contact_name}},

Vi que revisaste la información de SCENCE y quería ayudarte con el siguiente paso.

Podemos preparar para {{company_name}} una primera propuesta de campaña con creadoras de contenido, alineada a su público y objetivos.

Si te hace sentido, responde este email y la armamos contigo.

Saludos,
Pri
SCENCE`,
    defaultButtonLabel: 'Crear mi campaña →',
    defaultButtonUrl: 'https://scence-app.vercel.app/register',
  },
  { key: 'booking_confirmed', name: 'Booking confirmado', description: 'Confirma fecha, lugar y participación en un booking.', category: 'campaigns', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['recipient_name', 'campaign_name', 'event_date', 'event_location'], defaultSubject: 'Booking confirmado: {{campaign_name}}' },
  { key: 'application_approved', name: 'Postulación aprobada', description: 'Informa a la influencer que fue seleccionada.', category: 'campaigns', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'campaign_name', 'brand_name', 'portal_url'], defaultSubject: '¡Tu postulación a {{campaign_name}} fue aprobada!' },
  { key: 'new_application', name: 'Nueva postulación recibida', description: 'Alerta a la marca sobre una nueva postulante.', category: 'campaigns', audience: 'brand', usage: 'automatic', contexts: ['system'], requiredVariables: ['recipient_name', 'influencer_name', 'campaign_name', 'review_url'], defaultSubject: 'Nueva postulación: {{campaign_name}}' },
  { key: 'campaign_available', name: 'Nueva campaña disponible', description: 'Difusión automática de una campaña abierta.', category: 'campaigns', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'campaign_name', 'campaign_type', 'apply_url'], defaultSubject: 'Nueva campaña abierta: {{campaign_name}}' },
  { key: 'sponsor_opportunity', name: 'Oportunidad para sponsor', description: 'Invita a marcas elegibles a postular como sponsor.', category: 'campaigns', audience: 'brand', usage: 'automatic', contexts: ['system'], requiredVariables: ['brand_name', 'campaign_name', 'benefits', 'opportunity_url'], defaultSubject: 'Nueva oportunidad sponsor: {{campaign_name}}' },
  { key: 'campaign_assignment', name: 'Invitación / asignación a campaña', description: 'Mensaje de asignación y acceso al brief.', category: 'campaigns', audience: 'influencer', usage: 'manual', contexts: ['campaign'], requiredVariables: ['influencer_name', 'campaign_name', 'portal_url'], defaultSubject: 'Fuiste asignada a {{campaign_name}}', defaultMessage: 'Ya puedes revisar los entregables y el brief de la campaña.', defaultButtonLabel: 'Ver campaña →' },
  { key: 'profile_completion', name: 'Completar perfil / Instagram', description: 'Solicita datos obligatorios faltantes.', category: 'access', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'profile_url'], defaultSubject: 'Acción requerida: completa tu perfil en Scence' },
  { key: 'content_approved', name: 'Contenido aprobado', description: 'Resultado positivo de revisión de contenido.', category: 'content', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'deliverable_title', 'campaign_name', 'deliverable_url'], defaultSubject: '✅ Tu contenido fue aprobado — {{campaign_name}}' },
  { key: 'content_rejected', name: 'Contenido rechazado', description: 'Solicita ajustes sobre contenido revisado.', category: 'content', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'deliverable_title', 'campaign_name', 'review_notes'], defaultSubject: '❌ Tu contenido necesita ajustes — {{campaign_name}}' },
  { key: 'campaign_content_reminder', name: 'Recordatorio de subir contenido', description: 'Incluye automáticamente los entregables pendientes.', category: 'content', audience: 'influencer', usage: 'manual_and_automatic', contexts: ['campaign', 'system'], requiredVariables: ['influencer_name', 'campaign_name', 'pending_deliverables', 'portal_url'], defaultSubject: 'Recordatorio: entregables pendientes en {{campaign_name}}', defaultMessage: 'Recuerda subir tus entregables pendientes dentro del plazo acordado.', defaultButtonLabel: 'Subir entregables →' },
  { key: 'bulk_send_summary', name: 'Resumen de envío masivo', description: 'Resultado interno de una ejecución masiva de CRM.', category: 'operations', audience: 'admin', usage: 'automatic', contexts: ['system'], requiredVariables: ['total', 'sent', 'skipped', 'failed'], defaultSubject: 'Envío masivo CRM terminado' },
  { key: 'invoice', name: 'Envío de factura', description: 'Factura y link de consulta para el cliente.', category: 'billing', audience: 'customer', usage: 'automatic', contexts: ['system'], requiredVariables: ['client_name', 'invoice_number', 'total', 'organization_name'], defaultSubject: 'Factura {{invoice_number}} de {{organization_name}}' },
  { key: 'attendance_confirmation', name: 'Confirmación de asistencia', description: 'Solicita confirmar o rechazar la asistencia.', category: 'attendance', audience: 'influencer', usage: 'manual_and_automatic', contexts: ['campaign', 'system'], requiredVariables: ['influencer_name', 'campaign_name', 'attendance_deadline', 'portal_url'], defaultSubject: 'Confirma tu asistencia: {{campaign_name}}', defaultMessage: 'Ya quedaste aceptada. Para asegurar tu cupo, confirma tu asistencia desde tu perfil de SCENCE.', defaultButtonLabel: 'Confirmar asistencia' },
  { key: 'attendance_reminder', name: 'Recordatorio de asistencia', description: 'Recuerda una confirmación de asistencia pendiente.', category: 'attendance', audience: 'influencer', usage: 'manual_and_automatic', contexts: ['campaign', 'system'], requiredVariables: ['influencer_name', 'campaign_name', 'attendance_deadline', 'portal_url'], defaultSubject: 'Recordatorio: confirma tu asistencia a {{campaign_name}}', defaultMessage: 'Te necesitamos para confirmar si asistirás a esta campaña.', defaultButtonLabel: 'Confirmar en Scence' },
  { key: 'attendance_closed', name: 'Cierre de cupo por no confirmar', description: 'Informa que el cupo fue liberado al vencer el plazo.', category: 'attendance', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'campaign_name'], defaultSubject: 'Cupos cerrados: {{campaign_name}}' },
  { key: 'booking_participation_confirmation', name: 'Confirmación de participación en booking', description: 'Solicita confirmar participación antes del booking.', category: 'attendance', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'event_title', 'event_date'], defaultSubject: '⚠️ Confirma tu participación: {{event_title}}' },
  { key: 'influencer_portal_invite', name: 'Invitación de acceso de influencer', description: 'Alta inicial en el portal de influencers.', category: 'access', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['name', 'action_link'], defaultSubject: 'Bienvenido a Scence — Crea tu contraseña' },
  { key: 'influencer_access_recovery', name: 'Recuperación de acceso de influencer', description: 'Regenera el acceso al portal de influencers.', category: 'access', audience: 'influencer', usage: 'automatic', contexts: ['system'], requiredVariables: ['name', 'action_link'], defaultSubject: 'Tu cuenta de SCENCE ya está lista' },
  { key: 'brand_portal_invite', name: 'Invitación de acceso de marca', description: 'Alta inicial en el portal de marcas.', category: 'access', audience: 'brand', usage: 'automatic', contexts: ['system'], requiredVariables: ['name', 'brand_name', 'action_link'], defaultSubject: 'Bienvenido al portal de marcas — {{brand_name}}' },
  { key: 'brand_access_recovery', name: 'Recuperación de acceso de marca', description: 'Regenera el acceso al portal de marcas.', category: 'access', audience: 'brand', usage: 'automatic', contexts: ['system'], requiredVariables: ['name', 'action_link'], defaultSubject: 'Tu link de acceso a Scence' },
  { key: 'team_invite', name: 'Invitación de miembros / equipo', description: 'Invita miembros con su rol al portal correspondiente.', category: 'access', audience: 'team', usage: 'automatic', contexts: ['system'], requiredVariables: ['name', 'role', 'brand_name', 'action_link'], defaultSubject: 'Invitación a Scence' },
  { key: 'new_content_submission', name: 'Nueva entrega de contenido para administración', description: 'Alerta interna de contenido enviado.', category: 'content', audience: 'admin', usage: 'automatic', contexts: ['system'], requiredVariables: ['influencer_name', 'deliverable_title', 'campaign_name'], defaultSubject: 'Nueva entrega de contenido — {{influencer_name}}' },
  { key: 'campaign_final_report', name: 'Reporte final de campaña', description: 'Entrega el PDF final con KPI y resultados.', category: 'campaigns', audience: 'customer', usage: 'automatic', contexts: ['system'], requiredVariables: ['campaign_name', 'report_pdf'], defaultSubject: 'Reporte final — {{campaign_name}}' },
  { key: 'nda_signature_pending', name: 'Firma pendiente de NDA', description: 'Solicita a la marca firmar el documento pendiente.', category: 'documents', audience: 'brand', usage: 'automatic', contexts: ['system'], requiredVariables: ['brand_name', 'template_name', 'deadline'], defaultSubject: 'Acción requerida: firma tu NDA SCENCE' },
  { key: 'nda_signed', name: 'Notificación de NDA firmado', description: 'Alerta interna cuando una marca firma su NDA.', category: 'documents', audience: 'admin', usage: 'automatic', contexts: ['system'], requiredVariables: ['brand_name', 'document_title'], defaultSubject: '[SCENCE] NDA firmado' },
  { key: 'subscription_confirmation', name: 'Confirmación de suscripción', description: 'Confirma al cliente la activación de su plan.', category: 'billing', audience: 'customer', usage: 'automatic', contexts: ['system'], requiredVariables: ['plan_name', 'launch_price', 'regular_price'], defaultSubject: 'Confirmación de suscripción SCENCE · {{plan_name}}' },
  { key: 'payment_internal', name: 'Notificación interna de pago', description: 'Alerta al equipo sobre un pago confirmado.', category: 'billing', audience: 'admin', usage: 'automatic', contexts: ['system'], requiredVariables: ['plan_name', 'customer_email', 'subscription_id'], defaultSubject: 'Nuevo pago confirmado · {{plan_name}}' },
  { key: 'support_ticket', name: 'Nuevo ticket de soporte', description: 'Alerta interna con acceso al ticket.', category: 'support', audience: 'admin', usage: 'automatic', contexts: ['system'], requiredVariables: ['ticket_title', 'submitter_name', 'message'], defaultSubject: '[Soporte Scence] Nuevo ticket: {{ticket_title}}' },
  { key: 'support_reply', name: 'Respuesta de soporte', description: 'Notifica al contacto una nueva respuesta.', category: 'support', audience: 'customer', usage: 'automatic', contexts: ['system'], requiredVariables: ['ticket_title', 'message', 'portal_url'], defaultSubject: '[Soporte Scence] Respondimos tu ticket: {{ticket_title}}' },
  { key: 'brand_pending_approval', name: 'Nueva marca pendiente de aprobación', description: 'Alerta interna de marca creada por una influencer.', category: 'operations', audience: 'admin', usage: 'automatic', contexts: ['system'], requiredVariables: ['brand_name', 'contact_name', 'influencer_name'], defaultSubject: '[Scence] Nueva marca para aprobar: {{brand_name}}' },
  { key: 'campaign_custom_message', name: 'Mensaje personalizado de campaña', description: 'Mensaje libre para influencers seleccionadas.', category: 'campaigns', audience: 'influencer', usage: 'manual', contexts: ['campaign'], requiredVariables: ['influencer_name', 'campaign_name', 'portal_url'], defaultSubject: 'Mensaje sobre {{campaign_name}}', defaultMessage: 'Tenemos una actualización importante sobre esta campaña.', defaultButtonLabel: 'Ver campaña →' },
]

export const CAMPAIGN_EMAIL_CATALOG = EMAIL_CATALOG.filter(template =>
  template.contexts.includes('campaign') && template.audience === 'influencer' && template.usage !== 'automatic'
)

export const CRM_EMAIL_CATALOG = EMAIL_CATALOG.filter(template =>
  template.contexts.includes('crm') && ['brand', 'customer'].includes(template.audience) && template.usage !== 'automatic'
)

export function getEmailTemplate(key: string): EmailTemplateDefinition | undefined {
  return EMAIL_CATALOG.find(template => template.key === key)
}

export function applyEmailVariables(value: string, variables: Record<string, string>): string {
  return Object.entries(variables).reduce((result, [key, replacement]) => result.replaceAll(`{{${key}}}`, replacement), value)
}
