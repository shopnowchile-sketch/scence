import { ADMIN_NOTIFICATION_EMAIL, FROM_EMAIL, getResend } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const SUPPORT_EMAIL = ADMIN_NOTIFICATION_EMAIL

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function emailShell(title: string, content: string, actionUrl: string, actionLabel: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 16px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eee">
      <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:24px;text-align:center;color:#fff;font-size:20px;font-weight:800">SCENCE</div>
      <div style="padding:28px"><h1 style="font-size:21px;color:#111827;margin:0 0 18px">${escapeHtml(title)}</h1>${content}
        <a href="${actionUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;padding:13px 20px;margin-top:24px;font-weight:600">${escapeHtml(actionLabel)} →</a>
      </div>
    </div>
  </body></html>`
}

export async function notifySupportOfNewTicket(input: {
  ticketId: string
  title: string
  description: string
  submitterName: string
  submitterEmail: string
  submitterType: 'Influencer' | 'Marca' | 'Usuario'
}) {
  const content = `<p style="color:#6b7280;line-height:1.6">Se creó un nuevo ticket de soporte.</p>
    <p style="color:#111827;line-height:1.6"><strong>Tipo:</strong> ${input.submitterType}<br><strong>Contacto:</strong> ${escapeHtml(input.submitterName)}<br><strong>Email:</strong> ${escapeHtml(input.submitterEmail)}</p>
    <div style="background:#f9fafb;border-radius:10px;padding:16px;color:#374151;white-space:pre-wrap"><strong>${escapeHtml(input.title)}</strong><br><br>${escapeHtml(input.description)}</div>`

  const { error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: SUPPORT_EMAIL,
    reply_to: input.submitterEmail || undefined,
    subject: `[Soporte Scence] Nuevo ticket: ${input.title}`,
    html: emailShell('Nuevo ticket de soporte', content, `${APP_URL}/admin-support`, 'Ver ticket'),
  })
  if (error) throw new Error(error.message)
}

export async function notifyContactOfSupportReply(input: {
  contactEmail: string
  contactName: string
  ticketTitle: string
  message: string
  portal: 'influencer' | 'brand'
}) {
  const portalUrl = input.portal === 'influencer' ? `${APP_URL}/inf-support` : `${APP_URL}/brand-support`
  const content = `<p style="color:#6b7280;line-height:1.6">Hola ${escapeHtml(input.contactName)}, el equipo de Scence respondió tu solicitud <strong>${escapeHtml(input.ticketTitle)}</strong>.</p>
    <div style="background:#f9fafb;border-radius:10px;padding:16px;color:#374151;white-space:pre-wrap">${escapeHtml(input.message)}</div>`

  const { error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: input.contactEmail,
    reply_to: SUPPORT_EMAIL,
    subject: `[Soporte Scence] Respondimos tu ticket: ${input.ticketTitle}`,
    html: emailShell('Tienes una nueva respuesta', content, portalUrl, 'Ver conversación'),
  })
  if (error) throw new Error(error.message)
}
