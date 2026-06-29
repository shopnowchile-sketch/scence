import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getResend, FROM_EMAIL } from '@/lib/resend'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

function bookingConfirmationEmail({
  influencerName,
  title,
  dateStr,
  location,
  isVirtual,
  description,
  confirmUrl,
  declineUrl,
}: {
  influencerName: string
  title: string
  dateStr: string
  location?: string | null
  isVirtual: boolean
  description?: string | null
  confirmUrl: string
  declineUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Confirmación de participación</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">SCENCE</span>
      <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px">Confirmación de participación requerida</p>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 8px">Hola ${influencerName} 👋</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px">
        Te invitamos a participar en el siguiente evento. <strong>Necesitamos que confirmes tu asistencia</strong> para asegurar tu lugar.
      </p>

      <div style="background:#f3f4f6;border-radius:12px;padding:20px;margin-bottom:24px">
        <p style="font-size:17px;font-weight:700;color:#111827;margin:0 0 12px">📌 ${title}</p>
        <p style="color:#374151;font-size:14px;margin:0 0 8px">📅 <strong>Fecha:</strong> ${dateStr}</p>
        ${location ? `<p style="color:#374151;font-size:14px;margin:0 0 8px">${isVirtual ? '💻' : '📍'} <strong>${isVirtual ? 'Link:' : 'Lugar:'}</strong> ${location}</p>` : ''}
        ${description ? `<p style="color:#6b7280;font-size:13px;margin:12px 0 0;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:12px">${description}</p>` : ''}
      </div>

      <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 12px">¿Puedes asistir?</p>

      <div style="display:flex;gap:12px;margin-bottom:24px">
        <a href="${confirmUrl}"
          style="flex:1;display:block;text-align:center;background:#059669;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 16px">
          ✅ Sí, confirmo asistencia
        </a>
        <a href="${declineUrl}"
          style="flex:1;display:block;text-align:center;background:#f3f4f6;color:#374151;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 16px;border:1px solid #e5e7eb">
          ❌ No puedo asistir
        </a>
      </div>

      <div style="background:#fef3c7;border-radius:10px;padding:14px;border:1px solid #fde68a">
        <p style="color:#92400e;font-size:12px;margin:0;line-height:1.5">
          ⚠️ Si no confirmas tu asistencia, no podremos asegurar tu lugar. Por favor responde a la brevedad.
          Si no puedes asistir, notifícanos para organizar el evento correctamente.
        </p>
      </div>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6">
      <p style="color:#d1d5db;font-size:11px;margin:0">Powered by Scence · Gestión de campañas e influencers</p>
    </div>
  </div>
</body>
</html>`
}

// ── POST /api/bookings/send-confirmations ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    influencer_ids: string[]
    title: string
    starts_at: string
    ends_at: string
    location?: string
    is_virtual?: boolean
    description?: string
    booking_ids?: string[]
  }

  const { influencer_ids, title, starts_at, ends_at, location, is_virtual, description } = body

  if (!influencer_ids?.length || !title || !starts_at) {
    return NextResponse.json({ error: 'influencer_ids, title, starts_at are required' }, { status: 422 })
  }

  const admin = createAdminClient()

  // Fetch influencer emails
  const { data: influencers } = await admin
    .from('influencers')
    .select('id, display_name, email')
    .in('id', influencer_ids)

  if (!influencers?.length) {
    return NextResponse.json({ error: 'No influencers found' }, { status: 404 })
  }

  // Format date
  const startDate = new Date(starts_at)
  const endDate   = new Date(ends_at)
  const dateStr = `${format(startDate, "EEEE d 'de' MMMM yyyy, HH:mm", { locale: es })} — ${format(endDate, 'HH:mm', { locale: es })} hrs`

  const resend = getResend()
  const results: { influencer_id: string; email_sent: boolean; error?: string }[] = []

  for (const inf of influencers) {
    if (!inf.email) {
      results.push({ influencer_id: inf.id, email_sent: false, error: 'No email' })
      continue
    }

    const confirmUrl = `${APP_URL}/api/bookings/confirm?influencer_id=${inf.id}&action=confirm&title=${encodeURIComponent(title)}`
    const declineUrl = `${APP_URL}/api/bookings/confirm?influencer_id=${inf.id}&action=decline&title=${encodeURIComponent(title)}`

    const { error: emailErr } = await resend.emails.send({
      from: FROM_EMAIL,
      to: inf.email,
      subject: `⚠️ Confirma tu participación: ${title}`,
      html: bookingConfirmationEmail({
        influencerName: inf.display_name,
        title,
        dateStr,
        location: location || null,
        isVirtual: is_virtual ?? false,
        description: description || null,
        confirmUrl,
        declineUrl,
      }),
    })

    results.push({
      influencer_id: inf.id,
      email_sent: !emailErr,
      error: emailErr ? String(emailErr) : undefined,
    })
  }

  const sent = results.filter(r => r.email_sent).length
  return NextResponse.json({
    message: `Emails enviados a ${sent}/${influencers.length} influencers`,
    results,
  })
}
