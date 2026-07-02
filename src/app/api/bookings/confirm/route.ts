import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL, bookingConfirmEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// ── GET /api/bookings/confirm?influencer_id=&action=confirm|decline&title= ────
// One-click confirm/decline from email link — no auth required (token-less for MVP)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const influencer_id = searchParams.get('influencer_id')
  const action        = searchParams.get('action') // 'confirm' | 'decline'
  const title         = searchParams.get('title') ?? 'el evento'
  const token         = searchParams.get('token') ?? null

  if (!influencer_id || !['confirm', 'decline'].includes(action ?? '')) {
    return new NextResponse('Link inválido', { status: 400 })
  }

  const admin = createAdminClient()

  // Update the most recent booking for this influencer
  const { data: bookings } = await admin
    .from('bookings')
    .select(`
      id, confirmation_token, title, location, is_virtual, virtual_link, starts_at,
      campaign:campaigns ( name, brand:brands!campaigns_brand_id_fkey ( name ) ),
      influencer:influencers ( display_name, email )
    `)
    .eq('influencer_id', influencer_id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (bookings?.length) {
    const booking = bookings[0] as unknown as {
      id: string; confirmation_token: string | null; title: string
      location: string | null; is_virtual: boolean; virtual_link: string | null
      starts_at: string
      campaign: { name: string; brand: { name: string } | null } | null
      influencer: { display_name: string; email: string | null } | null
    }

    // Token validation: if a token is provided in the URL, it must match
    // If no token provided (legacy links), allow for backward compatibility
    if (token !== null && booking.confirmation_token && token !== booking.confirmation_token) {
      return new NextResponse('Token inválido', { status: 403 })
    }

    await admin
      .from('bookings')
      .update({
        confirmation_status: action === 'confirm' ? 'confirmed' : 'declined',
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)

    // ── Email de confirmación (gap G-08, cerrado 2026-07-01) ───────────────────
    // No bloqueante: si falla, la confirmación en BD ya quedó registrada.
    if (action === 'confirm' && booking.influencer?.email) {
      try {
        const { error: emailErr } = await getResend().emails.send({
          from: FROM_EMAIL,
          to: booking.influencer.email,
          subject: `Booking confirmado: ${booking.title}`,
          html: bookingConfirmEmail({
            recipientName: booking.influencer.display_name,
            campaignName:  booking.campaign?.name ?? 'Scence',
            eventTitle:    booking.title,
            eventDate:     new Date(booking.starts_at).toLocaleString('es-CL', {
              dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago',
            }),
            eventLocation: booking.is_virtual ? (booking.virtual_link ?? undefined) : (booking.location ?? undefined),
            brandName:     booking.campaign?.brand?.name ?? 'Scence',
            bookingUrl:    `${APP_URL}/inf-bookings`,
          }),
        })
        // Resend no lanza excepción en errores de API — hay que revisar `error`.
        if (emailErr) console.error('[booking confirm email] Resend devolvió error:', emailErr)
      } catch (e) {
        console.error('[booking confirm email] non-fatal:', e)
      }
    }
  }

  // Redirect to a simple thank-you page
  const message = action === 'confirm'
    ? `✅ ¡Genial! Tu participación en "${decodeURIComponent(title)}" ha sido confirmada. ¡Nos vemos!`
    : `❌ Hemos registrado que no podrás asistir a "${decodeURIComponent(title)}". Gracias por avisarnos.`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Scence</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:-apple-system,sans-serif;background:#f9fafb;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
  <div style="max-width:440px;width:100%;background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="font-size:48px;margin-bottom:16px">${action === 'confirm' ? '✅' : '😔'}</div>
    <p style="font-size:18px;font-weight:700;color:#111827;margin:0 0 12px">${action === 'confirm' ? '¡Participación confirmada!' : 'Gracias por avisarnos'}</p>
    <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px">${message}</p>
    <a href="${APP_URL}/influencer/dashboard"
      style="display:inline-block;background:#7c3aed;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;padding:12px 24px">
      Ir a mi portal →
    </a>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
