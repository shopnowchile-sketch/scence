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
//
// FIX (2026-07-02): el portal influencer ahora exige Instagram + comuna +
// dirección para poder entrar (ProfileCompletionGate en el layout). Antes
// este aviso solo cubría "sin Instagram" — se amplía para incluir también a
// quienes ya tienen Instagram pero les falta comuna o dirección, si no
// quedarían bloqueadas del portal sin haber recibido aviso.
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
    const missingInstagram = scan.filter(i => !i.instagram_url && !i.instagram_username && i.email)

    const { data: addrRows } = await admin
      .from('influencers')
      .select('id, display_name, email, address, commune')
      .eq('organization_id', orgId)
    const missingAddressOrCommune = (addrRows ?? []).filter(
      r => r.email && (!r.address || !String(r.address).trim() || !r.commune || !String(r.commune).trim())
    )

    const targetsById = new Map<string, { id: string; display_name: string | null; email: string | null }>()
    for (const i of missingInstagram) targetsById.set(i.id, { id: i.id, display_name: i.display_name, email: i.email })
    for (const r of missingAddressOrCommune) targetsById.set(r.id, { id: r.id, display_name: r.display_name, email: r.email })
    const targets = Array.from(targetsById.values())

    if (body.dryRun) {
      return NextResponse.json({
        dryRun: true,
        count: targets.length,
        preview: targets.slice(0, 20).map(i => ({ id: i.id, display_name: i.display_name, email: i.email })),
      })
    }

    if (!targets.length) return NextResponse.json({ success: true, sent: 0, failed: 0 })

    // FIX (2026-07-02, B-17): Resend limita a 10 req/seg por cuenta. Un envío
    // masivo sin pausa saturaba el límite (429 en cascada) y de paso bloqueaba
    // otros correos de la misma cuenta de Resend, incluido el de confirmación
    // de registro (Supabase Auth usa el mismo SMTP). Se agrega una pausa de
    // 150ms entre envíos (~6-7 req/seg) para quedar bajo el límite.
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    let sent = 0
    let failed = 0
    for (const inf of targets) {
      try {
        const { error: emailErr } = await getResend().emails.send({
          from: FROM_EMAIL,
          to: inf.email as string,
          subject: 'Acción requerida: completa tu perfil en Scence',
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
      await sleep(150)
    }

    return NextResponse.json({ success: true, sent, failed })
  } catch (e) {
    console.error('[POST notify-no-instagram]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
