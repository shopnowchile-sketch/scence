import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

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
    .select('id, confirmation_token')
    .eq('influencer_id', influencer_id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (bookings?.length) {
    const booking = bookings[0]

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
