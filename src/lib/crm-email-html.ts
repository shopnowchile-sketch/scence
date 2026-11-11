function escapeEmailHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const presentationLinks: Record<string, string> = {
  'www.scence.cl': 'https://www.scence.cl',
  '@influencers.snc': 'https://www.instagram.com/influencers.snc/',
  'WhatsApp: +56 9 7526 5196': 'https://wa.me/56975265196',
}

// Layout de los emails COMERCIALES del CRM. Es el único con pie de baja: los
// templates transaccionales no lo llevan ni deben llevarlo.
export function crmCatalogEmail({
  message,
  buttonLabel,
  buttonUrl,
  unsubscribeUrl,
  registerLinks,
  presentation = false,
}: {
  message: string
  presentation?: boolean
  buttonLabel?: string
  buttonUrl?: string
  unsubscribeUrl?: string | null
  registerLinks?: { brandUrl: string; creatorUrl: string }
}): string {
  const escapedMessage = escapeEmailHtml(message)
  const safeMessage = (presentation
    ? escapedMessage
      .replace(/www\.scence\.cl|@influencers\.snc|WhatsApp: \+56 9 7526 5196/g, label =>
        `<a href="${presentationLinks[label]}" style="color:#6d28d9;text-decoration:underline">${label}</a>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    : escapedMessage).replaceAll('\n', '<br>')
  const safeButtonLabel = buttonLabel ? escapeEmailHtml(buttonLabel) : ''
  const safeButtonUrl = buttonUrl ? escapeEmailHtml(buttonUrl) : ''
  const safeUnsubscribeUrl = unsubscribeUrl ? escapeEmailHtml(unsubscribeUrl) : ''
  const linkStyle = 'display:inline-block;margin-top:6px;background:#7c3aed;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;padding:10px 18px'
  const registerSection = registerLinks ? `<div style="margin-top:28px;padding:20px;border:1px solid #ede9fe;border-radius:12px;background:#faf5ff">
        <p style="margin:0 0 6px;color:#374151;font-size:15px"><strong>Si eres marca</strong>, regístrate para crear una campaña.</p>
        <a href="${escapeEmailHtml(registerLinks.brandUrl)}" style="${linkStyle}">Registrar mi marca</a>
        <p style="margin:20px 0 6px;color:#374151;font-size:15px"><strong>Si eres creador de contenido</strong>, regístrate para crear contenido para marcas.</p>
        <a href="${escapeEmailHtml(registerLinks.creatorUrl)}" style="${linkStyle}">Unirme como creador de contenido</a>
      </div>` : ''

  const unsubscribeColor = presentation ? '#6b7280' : '#9ca3af'
  const unsubscribe = safeUnsubscribeUrl ? `<p style="color:${unsubscribeColor};font-size:11px;line-height:1.6;margin:8px 0 0">Si no quieres recibir más correos como este, <a href="${safeUnsubscribeUrl}" style="color:${unsubscribeColor};text-decoration:underline">date de baja aquí</a>.</p>` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">${presentation ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}<title>SCENCE</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    ${presentation ? '' : `<div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:28px;text-align:center">
      <span style="color:#fff;font-size:20px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>`}
    <div style="padding:32px">
      <div style="color:#374151;font-size:15px;line-height:1.7">${safeMessage}</div>
      ${registerSection}
      ${safeButtonLabel && safeButtonUrl ? `<a href="${safeButtonUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-top:24px">${safeButtonLabel}</a>` : ''}
    </div>
    ${presentation ? `<div style="padding:0 32px 24px">${unsubscribe}</div>` : `<div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#374151;font-size:13px;font-weight:600;margin:0 0 8px">Síguenos en Instagram</p>
      <p style="color:#6b7280;font-size:13px;line-height:1.9;margin:0 0 12px">
        <a href="https://www.instagram.com/scence.cl/" style="color:#7c3aed;font-weight:600;text-decoration:none">@scence.cl</a> · <a href="https://www.instagram.com/scence.cl/" style="color:#6b7280;text-decoration:underline">instagram.com/scence.cl</a><br>
        <a href="https://www.instagram.com/influencers.snc/" style="color:#7c3aed;font-weight:600;text-decoration:none">@influencers.snc</a> · <a href="https://www.instagram.com/influencers.snc/" style="color:#6b7280;text-decoration:underline">instagram.com/influencers.snc</a>
      </p>
      <p style="color:#6b7280;font-size:12px;line-height:1.7;margin:0 0 8px">
        <a href="mailto:hola@scence.cl" style="color:#7c3aed;text-decoration:none">hola@scence.cl</a> ·
        <a href="https://scence.cl" style="color:#7c3aed;text-decoration:none">scence.cl</a>
      </p>
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
      ${unsubscribe}
    </div>`}
  </div>
</body>
</html>`
}
