import { Resend } from 'resend'

// Lazy — only instantiated at request time, never at build time
let _resend: Resend | null = null
export function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder')
  return _resend
}

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'Scence <noreply@scence.app>'
// Destino único de las alertas internas de operación. No se usa para emails
// dirigidos a marcas, influencers o clientes.
export const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'hola.scence@gmail.com'

// ── Email templates (inline HTML — no React Email dependency needed) ──────────

export function passwordResetEmail({ actionLink }: { actionLink: string }): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Restablece tu contraseña</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">Restablece tu contraseña</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Recibimos una solicitud para restablecer tu contraseña. Haz clic abajo para crear una nueva.
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Crear nueva contraseña →
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Este link expira en 1 hora. Si no solicitaste esto puedes ignorar este correo — tu contraseña actual seguirá funcionando.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function brandSignupConfirmEmail({ contactName, actionLink }: { contactName: string; actionLink: string }): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Confirma tu cuenta Scence</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px">Hola ${contactName} 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Confirma tu cuenta para activar tu registro en el portal de marcas de <strong style="color:#111827">Scence</strong>.
        Un miembro de nuestro equipo revisará tu cuenta antes de darte acceso completo.
      </p>
      <a href="${actionLink}"
        style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Confirmar mi cuenta →
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Este link expira en 24 horas. Si no creaste esta cuenta puedes ignorar este correo.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Portal de Marcas</p>
    </div>
  </div>
</body>
</html>`
}

export function influencerInviteEmail({
  influencerName,
  campaignName,
  brandName,
  inviteUrl,
  message,
}: {
  influencerName: string
  campaignName: string
  brandName: string
  inviteUrl: string
  message?: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Invitación a campaña</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 16px">
        <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.5px">SCENCE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:10px;font-weight:600;background:rgba(255,255,255,0.15);border-radius:4px;padding:2px 6px">BETA</span>
      </div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Hola ${influencerName} 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        <strong style="color:#111827">${brandName}</strong> te invita a participar en la campaña
        <strong style="color:#7c3aed">${campaignName}</strong>.
      </p>
      ${message ? `<div style="background:#f3f4f6;border-radius:10px;padding:16px;margin-bottom:24px;font-size:14px;color:#374151;line-height:1.6"><em>"${message}"</em></div>` : ''}
      <a href="${inviteUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Ver invitación →
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Si no esperabas esta invitación puedes ignorar este correo.
        Para más información contacta a ${brandName}.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Plataforma de gestión de campañas</p>
    </div>
  </div>

          <p style="margin-top:24px;font-size:14px;color:#6b7280;">
            También nos puedes conocer en Instagram:<br>
            <a href="https://www.instagram.com/influencers.snc/" style="color:#7c3aed;text-decoration:none;">@influencers.snc</a><br>
            <a href="https://www.instagram.com/scence.cl/" style="color:#7c3aed;text-decoration:none;">@scence.cl</a>
          </p>

</body>
</html>`
}

// CRM — email de presentación a prospectos (leads) ofreciendo primera campaña gratis.
export function crmIntroEmail({
  contactName,
  companyName,
}: {
  contactName: string
  companyName: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Conoce Scence</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 16px">
        <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.5px">SCENCE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:10px;font-weight:600;background:rgba(255,255,255,0.15);border-radius:4px;padding:2px 6px">BETA</span>
      </div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Hola ${contactName} 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 20px">
        Somos <strong style="color:#111827">Scence</strong>, la plataforma para que marcas como
        <strong style="color:#111827">${companyName}</strong> gestionen campañas con influencers de principio a fin:
        búsqueda, negociación, entregables y pagos, todo en un solo lugar.
      </p>
      <div style="background:#f3f4f6;border-radius:10px;padding:16px;margin-bottom:24px;font-size:14px;color:#374151;line-height:1.6">
        🎁 Tu primera campaña es <strong>gratis</strong> — sin costo de setup, para que pruebes cómo funciona.
      </div>
      <a href="https://scence-app.vercel.app/register" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Crear mi primera campaña gratis →
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Si no te interesa, puedes ignorar este correo — no volveremos a escribirte por este medio.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Plataforma de gestión de campañas</p>
    </div>
  </div>
</body>
</html>`
}

export function bookingConfirmEmail({
  recipientName,
  campaignName,
  eventTitle,
  eventDate,
  eventLocation,
  brandName,
  bookingUrl,
}: {
  recipientName: string
  campaignName: string
  eventTitle: string
  eventDate: string
  eventLocation?: string
  brandName: string
  bookingUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Booking confirmado</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">📅</div>
      <p style="color:rgba(255,255,255,0.9);font-size:14px;font-weight:600;margin:0">Booking confirmado</p>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">¡Está en el calendario, ${recipientName}!</h1>
      <p style="color:#6b7280;font-size:15px;margin:0 0 24px">Tu participación en <strong style="color:#111827">${campaignName}</strong> fue confirmada.</p>
      <div style="background:#f3f4f6;border-radius:12px;padding:20px;margin-bottom:24px">
        <p style="color:#111827;font-weight:700;font-size:16px;margin:0 0 12px">${eventTitle}</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          <p style="color:#374151;font-size:14px;margin:0">📅 <strong>Fecha:</strong> ${eventDate}</p>
          ${eventLocation ? `<p style="color:#374151;font-size:14px;margin:0">📍 <strong>Lugar:</strong> ${eventLocation}</p>` : ''}
          <p style="color:#374151;font-size:14px;margin:0">🏢 <strong>Organizado por:</strong> ${brandName}</p>
        </div>
      </div>
      <a href="${bookingUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">
        Ver detalles →
      </a>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function campaignApplicationApprovedEmail({
  influencerName,
  campaignName,
  brandName,
  appUrl,
}: {
  influencerName: string
  campaignName: string
  brandName?: string | null
  appUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Postulación aprobada</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#059669,#10b981);padding:32px;text-align:center">
      <div style="font-size:40px">🎉</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">¡Felicidades, ${influencerName}!</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Tu postulación a la campaña <strong style="color:#111827">${campaignName}</strong>${brandName ? ` de <strong style="color:#111827">${brandName}</strong>` : ''} fue aprobada. Ya puedes revisar los entregables y comenzar a trabajar.
      </p>
      <a href="${appUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">
        Ver mis entregables →
      </a>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function campaignNewApplicationEmail({
  recipientName,
  influencerName,
  campaignName,
  message,
  reviewUrl,
}: {
  recipientName: string
  influencerName: string
  campaignName: string
  message?: string | null
  reviewUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Nueva postulación</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <div style="font-size:36px">📥</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Hola ${recipientName}</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        <strong style="color:#111827">${influencerName}</strong> se postuló a tu campaña
        <strong style="color:#7c3aed">${campaignName}</strong>. Revisa su perfil y acéptala o recházala.
      </p>
      ${message ? `<div style="background:#f3f4f6;border-radius:10px;padding:16px;margin-bottom:24px;font-size:14px;color:#374151;line-height:1.6"><em>"${message}"</em></div>` : ''}
      <a href="${reviewUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">
        Revisar postulación →
      </a>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function campaignOpenAvailableEmail({
  influencerName,
  campaignName,
  campaignType,
  applyUrl,
}: {
  influencerName: string
  campaignName: string
  campaignType?: string | null
  applyUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Nueva campaña disponible</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <div style="font-size:36px">✨</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">Hola ${influencerName} 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Hay una nueva campaña abierta para postular:
        <strong style="color:#7c3aed">${campaignName}</strong>${campaignType ? ` (${campaignType.replace(/_/g, ' ')})` : ''}.
        Te la mandamos porque estás entre las influencers con más alcance del roster.
      </p>
      <a href="${applyUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px;margin-bottom:24px">
        Ver campaña y postular →
      </a>
      <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0">
        Postular no es un compromiso — el equipo revisa y confirma antes de asignarte a la campaña.
      </p>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Plataforma de gestión de campañas</p>
    </div>
  </div>
</body>
</html>`
}

export function sponsorOpportunityEmail({ brandName, campaignName, campaignType, benefits, opportunityUrl }: { brandName: string; campaignName: string; campaignType?: string | null; benefits?: string | null; opportunityUrl: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nueva oportunidad para sponsors</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)"><div style="background:linear-gradient(135deg,#7c3aed,#c026d3);padding:32px;text-align:center;color:#fff;font-size:30px">🤝</div><div style="padding:32px"><h1 style="font-size:22px;color:#111827;margin:0 0 12px">Nueva oportunidad para ${brandName}</h1><p style="color:#6b7280;font-size:15px;line-height:1.6">La campaña <strong style="color:#7c3aed">${campaignName}</strong>${campaignType ? ` (${campaignType.replace(/_/g, ' ')})` : ''} está recibiendo postulaciones de marcas sponsor.</p>${benefits ? `<div style="margin:20px 0;padding:16px;border-radius:10px;background:#faf5ff;color:#4c1d95;font-size:14px;line-height:1.5">${benefits}</div>` : ''}<p style="color:#6b7280;font-size:14px;line-height:1.6">En el portal encontrarás el material privado para marcas, las condiciones y el formulario de postulación.</p><a href="${opportunityUrl}" style="display:block;margin-top:24px;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">Ver oportunidad y postular →</a></div></div></body></html>`
}

export function campaignAssignedEmail({
  influencerName,
  campaignName,
  campaignType,
  campaignUrl,
  message,
  buttonLabel = 'Ver campaña →',
}: {
  influencerName: string
  campaignName: string
  campaignType?: string | null
  campaignUrl: string
  message?: string
  buttonLabel?: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Nueva campaña asignada</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#059669,#10b981);padding:32px;text-align:center">
      <div style="font-size:40px">🎬</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">¡Felicidades, ${influencerName}!</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Fuiste asignada a la campaña <strong style="color:#111827">${campaignName}</strong>${campaignType ? ` (${campaignType.replace(/_/g, ' ')})` : ''}. Ya puedes revisar los entregables y el brief.
      </p>
      ${message ? `<div style="background:#f3f4f6;border-radius:10px;padding:16px;margin-bottom:24px;font-size:14px;color:#374151;line-height:1.6">${message}</div>` : ''}
      <a href="${campaignUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">
        ${buttonLabel}
      </a>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function requestProfileUpdateEmail({
  influencerName,
  profileUrl,
}: {
  influencerName: string
  profileUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Actualiza tu perfil en Scence</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <div style="font-size:36px">📋</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 8px">Hola ${influencerName} 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Nos falta tu <strong style="color:#111827">Instagram</strong>, tu <strong style="color:#111827">comuna</strong> y/o tu <strong style="color:#111827">dirección</strong> en tu perfil de Scence.
      </p>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        A partir de ahora estos datos son obligatorios para usar el portal — sin ellos no podrás entrar a tus campañas hasta completarlos. Tómate 1 minuto para actualizarlos.
      </p>
      <a href="${profileUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">
        Actualizar mi perfil →
      </a>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function deliverableStatusEmail({
  influencerName,
  deliverableTitle,
  campaignName,
  status,
  reviewNotes,
  deliverableUrl,
}: {
  influencerName: string
  deliverableTitle: string
  campaignName: string
  status: 'approved' | 'rejected'
  reviewNotes?: string
  deliverableUrl: string
}): string {
  const isApproved = status === 'approved'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:${isApproved ? 'linear-gradient(135deg,#059669,#10b981)' : 'linear-gradient(135deg,#dc2626,#ef4444)'};padding:32px;text-align:center">
      <div style="font-size:40px">${isApproved ? '✅' : '❌'}</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">
        Hola ${influencerName}, tu contenido fue ${isApproved ? 'aprobado' : 'rechazado'}
      </h1>
      <p style="color:#6b7280;font-size:15px;margin:0 0 24px">
        Tu entrega <strong style="color:#111827">${deliverableTitle}</strong> para la campaña
        <strong style="color:#111827">${campaignName}</strong> fue revisada.
      </p>
      ${reviewNotes ? `<div style="background:${isApproved ? '#f0fdf4' : '#fef2f2'};border-radius:10px;padding:16px;margin-bottom:24px;font-size:14px;color:${isApproved ? '#065f46' : '#991b1b'};line-height:1.6"><strong>Notas de revisión:</strong><br>${reviewNotes}</div>` : ''}
      <a href="${deliverableUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">
        Ver deliverable →
      </a>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function deliverableReminderEmail({
  influencerName,
  campaignName,
  pendingTitles,
  appUrl,
  message,
  buttonLabel = 'Subir entregables →',
}: {
  influencerName: string
  campaignName: string
  pendingTitles: string[]
  appUrl: string
  message?: string
  buttonLabel?: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:32px;text-align:center">
      <div style="font-size:40px">⏰</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px">
        Hola ${influencerName}, tienes entregables pendientes
      </h1>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px">
        En la campaña <strong style="color:#111827">${campaignName}</strong> aún te faltan por subir:
      </p>
      <ul style="color:#374151;font-size:14px;line-height:1.8;margin:0 0 24px;padding-left:20px">
        ${pendingTitles.map(t => `<li>${t}</li>`).join('')}
      </ul>
      <div style="background:#fef3c7;border-radius:10px;padding:16px;margin-bottom:24px;font-size:14px;color:#92400e;line-height:1.6">
        ${message || 'Recuerda subir tus entregables pendientes. Si la campaña cierra y no están enviados, esto puede afectar tu rating.'}
      </div>
      <a href="${appUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">
        ${buttonLabel}
      </a>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence</p>
    </div>
  </div>
</body>
</html>`
}

export function attendanceConfirmationEmail({
  influencerName,
  campaignName,
  campaignId,
  dueDate,
  message,
  actionUrl,
  buttonLabel = 'Confirmar asistencia',
}: {
  influencerName: string
  campaignName: string
  campaignId: string
  dueDate?: string | null
  message?: string
  actionUrl?: string
  buttonLabel?: string
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
  const dueLabel = dueDate
    ? new Date(`${dueDate}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7fb;margin:0;padding:32px 0;color:#1f2937"><div style="max-width:540px;margin:auto;background:#fff;border-radius:18px;overflow:hidden"><div style="padding:28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff"><b style="font-size:20px">Confirma tu asistencia</b></div><div style="padding:28px"><p>Hola ${influencerName},</p><p>${message || `Ya quedaste aceptada en <b>${campaignName}</b>. Para asegurar tu cupo, confirma tu asistencia desde tu perfil de SCENCE.`}</p>${dueLabel ? `<p><b>Fecha límite:</b> ${dueLabel}</p>` : ''}<a href="${actionUrl || `${appUrl}/inf-campaign/${campaignId}`}" style="display:block;padding:14px;border-radius:10px;background:#7c3aed;color:#fff;text-align:center;font-weight:700;text-decoration:none">${buttonLabel}</a></div></div></body></html>`
}

export function attendanceReminderEmail({
  influencerName,
  campaignName,
  campaignId,
  dueDate,
  message,
  actionUrl,
  buttonLabel = 'Confirmar en Scence',
}: {
  influencerName: string
  campaignName: string
  campaignId: string
  dueDate: string
  message?: string
  actionUrl?: string
  buttonLabel?: string
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
  return `<!doctype html><html><body style="margin:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937"><div style="max-width:540px;margin:32px auto;background:#fff;border-radius:18px;overflow:hidden"><div style="padding:28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff"><div style="font-size:28px">✋</div><b style="font-size:20px">Confirma tu asistencia</b></div><div style="padding:28px"><p>Hola ${influencerName},</p><p>Te necesitamos para confirmar si asistirás a <b>${campaignName}</b>.</p>${message ? `<div style="padding:14px;border-radius:10px;background:#f5f3ff">${message}</div>` : ''}<p><b>Fecha límite:</b> ${dueDate}</p><p style="padding:12px;border-radius:10px;background:#fff7ed;color:#9a3412"><b>Importante:</b> si no confirmas dentro del plazo, tu cupo se liberará para poder invitar a otra creadora.</p><a href="${actionUrl || `${appUrl}/inf-campaign/${campaignId}`}" style="display:block;padding:14px;border-radius:10px;background:#7c3aed;color:#fff;text-align:center;font-weight:700;text-decoration:none">${buttonLabel}</a><p style="font-size:12px;color:#6b7280">Responde Sí, asistiré o No podré asistir. Tu respuesta ayuda a organizar la experiencia.</p></div></div></body></html>`
}

export function attendanceClosedEmail({ influencerName }: { influencerName: string }): string {
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7fb;margin:0;padding:32px;color:#1f2937"><div style="max-width:540px;margin:auto;background:#fff;border-radius:18px;padding:28px"><p>Hola ${influencerName},</p><p>Lo sentimos, no confirmaste tu asistencia antes de la fecha límite y los cupos se cerraron.</p></div></body></html>`
}

export function campaignCustomMessageEmail({
  influencerName,
  campaignName,
  message,
  actionUrl,
  buttonLabel = 'Ver campaña →',
}: {
  influencerName: string
  campaignName: string
  message: string
  actionUrl: string
  buttonLabel?: string
}): string {
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7fb;margin:0;padding:32px;color:#1f2937"><div style="max-width:540px;margin:auto;background:#fff;border-radius:18px;overflow:hidden"><div style="padding:28px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff"><b style="font-size:20px">SCENCE</b></div><div style="padding:28px"><p>Hola ${influencerName},</p><p style="line-height:1.6">${message}</p><p style="color:#6b7280">Campaña: <b>${campaignName}</b></p><a href="${actionUrl}" style="display:block;padding:14px;border-radius:10px;background:#7c3aed;color:#fff;text-align:center;font-weight:700;text-decoration:none">${buttonLabel}</a></div></div></body></html>`
}

// Notificación interna al admin que lanzó un envío masivo de CRM, cuando el
// job terminó de procesar todas las tandas en background.
export function bulkSendCompleteEmail({
  total,
  sent,
  skipped,
  failed,
}: {
  total: number
  sent: number
  skipped: number
  failed: number
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:28px;text-align:center">
      <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.5px">SCENCE — CRM</span>
    </div>
    <div style="padding:28px">
      <h1 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 16px">Envío masivo terminado</h1>
      <div style="background:#f3f4f6;border-radius:10px;padding:16px;font-size:14px;color:#374151;line-height:1.8">
        <p style="margin:0">Total solicitado: <strong>${total}</strong></p>
        <p style="margin:0">Enviados: <strong style="color:#059669">${sent}</strong></p>
        <p style="margin:0">Sin email (omitidos): <strong>${skipped}</strong></p>
        <p style="margin:0">Fallidos: <strong style="color:#dc2626">${failed}</strong></p>
      </div>
    </div>
  </div>
</body>
</html>`
}

export function invoiceEmail({
  clientName,
  invoiceNumber,
  total,
  currency,
  dueDate,
  orgName,
  note,
  invoiceUrl,
}: {
  clientName: string
  invoiceNumber: string
  total: number
  currency: string
  dueDate?: string | null
  orgName: string
  note?: string
  invoiceUrl?: string
}): string {
  const fmt = new Intl.NumberFormat('es-CL', { style: 'currency', currency, minimumFractionDigits: 0 })
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Factura ${invoiceNumber}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
      <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:8px 0 0">Factura</p>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 6px">Factura ${invoiceNumber}</h1>
      <p style="color:#6b7280;font-size:14px;margin:0 0 24px">De parte de <strong style="color:#111827">${orgName}</strong></p>
      
      ${note ? `<div style="background:#f3f4f6;border-radius:10px;padding:14px 16px;margin-bottom:20px;font-size:14px;color:#374151;line-height:1.6">${note}</div>` : ''}

      <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:12px;padding:20px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="color:#6b7280;font-size:13px">Cliente</span>
          <span style="color:#111827;font-weight:600;font-size:14px">${clientName}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="color:#6b7280;font-size:13px">Total</span>
          <span style="color:#7c3aed;font-weight:800;font-size:20px">${fmt.format(total)}</span>
        </div>
        ${dueDate ? `<div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#6b7280;font-size:13px">Vencimiento</span>
          <span style="color:#111827;font-size:14px;font-weight:600">${dueDate}</span>
        </div>` : ''}
      </div>

      ${invoiceUrl ? `<a href="${invoiceUrl}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;padding:14px 24px">Ver factura completa →</a>` : ''}
    </div>
    <div style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Enviado por ${orgName} via Scence</p>
    </div>
  </div>
</body>
</html>`
}
