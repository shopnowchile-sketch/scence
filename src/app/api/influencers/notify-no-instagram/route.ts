import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { loadScan } from '@/lib/influencers/dataQuality'
import { getResend, FROM_EMAIL, requestProfileUpdateEmail } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

// POST /api/influencers/notify-no-instagram
// body: { dryRun?: boolean }
// Reemplaza el borrado directo de "influencers sin Instagram" (Data Quality):
// en vez de eliminarlas, se les manda un email pidiendo que completen
// Instagram y/o dirección en su perfil (pedido por Pri). Mismo criterio de
// selección que /api/influencers/delete-no-instagram (loadScan), que sigue
// existiendo por si se necesita en otro flujo, pero el botón de Data Quality
// ya no lo usa.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: { dryRun?: boolean } = {}
  try { body = await req.json() } catch { /* sin body ok */ }

  try {
    const scan = await loadScan(admin, orgId)
    const noInstagram = scan.filter(i => !i.instagram_url && !i.instagram_username && i.email)

    if (body.dryRun) {
      return NextResponse.json({
        dryRun: true,
        count: noInstagram.length,
        preview: noInstagram.slice(0, 20).map(i => ({ id: i.id, display_name: i.display_name, email: i.email })),
      })
    }

    if (!noInstagram.length) return NextResponse.json({ success: true, sent: 0, failed: 0 })

    let sent = 0
    let failed = 0
    for (const inf of noInstagram) {
      try {
        const { error: emailErr } = await getResend().emails.send({
          from: FROM_EMAIL,
          to: inf.email as string,
          subject: 'Actualiza tu perfil en Scence',
          html: requestProfileUpdateEmail({
            influencerName: inf.display_name ?? 'Influencer',
            profileUrl: `${APP_URL}/inf-profile`,
          }),
        })
        // Resend no lanza excepción en errores de API — hay que revisar `error`.
        if (emailErr) {
          failed++
          console.error('[notify-no-instagram] Resend devolvió error:', inf.id, emailErr)
        } else {
          sent++
        }
      } catch (e) {
        failed++
        console.error('[notify-no-instagram] envío falló:', inf.id, e)
      }
    }

    return NextResponse.json({ success: true, sent, failed })
  } catch (e) {
    console.error('[POST notify-no-instagram]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
