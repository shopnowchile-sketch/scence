import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { recordOptOut, verifyUnsubscribeToken } from '@/lib/email-optouts'

// Ruta PÚBLICA: sin sesión, sin cookies. La autoriza el HMAC del token, no el
// usuario. Solo da de baja de los emails COMERCIALES del CRM — los correos
// transaccionales (acceso, facturas, reportes) no se ven afectados.
//
// GET  = muestra confirmación, NO escribe nada. Así un escáner de links o el
//        prefetch de un cliente de correo no puede dar de baja a nadie.
// POST = ejecuta la baja. Sirve tanto para el botón de la página como para el
//        botón nativo de un clic de Gmail/Outlook (RFC 8058), que llega sin
//        interacción adicional.
export const dynamic = 'force-dynamic'

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Robots-Tag': 'noindex, nofollow',
}

const P = 'color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 12px'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function page(title: string, body: string, status: number) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title} — SCENCE</title>
</head>
<body style="margin:0;padding:48px 16px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:24px;text-align:center">
      <span style="color:#fff;font-size:20px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE },
  })
}

// Misma respuesta para token inválido, lead inexistente o lead sin email: no
// confirma ni desmiente si una dirección está en la base, y nunca la muestra.
function invalidLinkPage() {
  return page(
    'No pudimos procesar la baja',
    `<p style="${P}">El enlace no es válido o ya expiró.</p>
     <p style="${P}">Si quieres dejar de recibir nuestros correos, respóndele a cualquiera de ellos y lo hacemos manualmente.</p>`,
    400,
  )
}

function readParams(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const leadId = searchParams.get('l') ?? ''
  const token = searchParams.get('t')
  return { leadId, token, valid: Boolean(leadId) && verifyUnsubscribeToken(leadId, token) }
}

// ── GET — clic en el link del pie del correo. NO escribe nada. ───────────────
export async function GET(request: NextRequest) {
  const { leadId, token, valid } = readParams(request)
  if (!valid) return invalidLinkPage()

  const action = `/api/unsubscribe?l=${encodeURIComponent(leadId)}&t=${encodeURIComponent(token ?? '')}`

  return page(
    '¿Quieres dejar de recibir comunicaciones comerciales de SCENCE?',
    `<p style="${P}">Dejarías de recibir nuestros correos de prospección y novedades comerciales.</p>
     <p style="${P}">Si tienes una cuenta en SCENCE, los correos de tu cuenta —acceso, campañas y reportes— seguirán llegando normalmente.</p>
     <form method="post" action="${escapeHtml(action)}" style="margin:24px 0 0">
       <button type="submit" style="display:block;width:100%;box-sizing:border-box;text-align:center;background:#7c3aed;color:#fff;font-size:15px;font-weight:600;border:0;border-radius:10px;padding:14px 24px;cursor:pointer">Darme de baja</button>
     </form>
     <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:16px 0 0">Si llegaste aquí por error, cierra esta página: no se ha hecho ningún cambio.</p>`,
    200,
  )
}

// ── POST — ejecuta la baja ──────────────────────────────────────────────────
// Lo llama el botón de la página y también Gmail/Outlook con
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, sin interacción del
// usuario. Un 2xx basta para el cliente de correo; devolvemos HTML porque la
// misma respuesta sirve para la persona que pulsó el botón.
export async function POST(request: NextRequest) {
  const { leadId, valid } = readParams(request)
  if (!valid) return invalidLinkPage()

  const admin = createAdminClient()

  const { data: lead, error } = await admin
    .from('crm_leads')
    .select('id, email')
    .eq('id', leadId)
    .maybeSingle()

  if (error || !lead?.email) return invalidLinkPage()

  // Idempotente: repetirla no duplica filas ni falla, y conserva el motivo
  // original. `inserted` es false cuando la dirección ya estaba dada de baja.
  const { ok, inserted } = await recordOptOut(admin, {
    email: lead.email,
    reason: 'unsubscribe',
    source: 'link',
    leadId: lead.id,
  })

  if (!ok) {
    return page(
      'No pudimos procesar la baja',
      `<p style="${P}">Hubo un problema al guardar tu solicitud. Vuelve a intentarlo en unos minutos.</p>
       <p style="${P}">También puedes responder cualquiera de nuestros correos y lo hacemos manualmente.</p>`,
      503,
    )
  }

  if (inserted) {
    // Reusa el timeline que ya existe — sin tabla nueva.
    await admin.from('crm_lead_activities').insert({
      lead_id: lead.id,
      action_type: 'note',
      description: 'Se dio de baja de los emails comerciales desde el link del correo.',
      created_by: null,
    })
  }

  return page(
    'Listo, te diste de baja',
    `<p style="${P}">No volverás a recibir correos comerciales de SCENCE en esta dirección.</p>
     <p style="${P}">Si tienes una cuenta en SCENCE, los correos de tu cuenta —acceso, campañas y reportes— siguen funcionando normalmente.</p>
     <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:20px 0 0">¿Fue sin querer? Escríbenos respondiendo cualquier correo nuestro y lo revertimos.</p>`,
    200,
  )
}
