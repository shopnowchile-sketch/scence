import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { isOrgAdmin } from '@/lib/influencers/authz'
import { FROM_EMAIL, getResend } from '@/lib/resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'

type RecoveryInfluencer = {
  id: string
  user_id: string | null
  email: string | null
  display_name: string | null
  metadata: Record<string, unknown> | null
}

function accessEmail(name: string, actionLink: string) {
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px 16px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:28px;text-align:center;color:#fff;font-size:22px;font-weight:900">SCENCE</div><div style="padding:32px"><h1 style="font-size:22px;color:#111827;margin:0 0 12px">Hola ${name} 👋</h1><p style="color:#4b5563;font-size:15px;line-height:1.6">Tu cuenta de influencer en SCENCE ya está lista. Hubo un problema anterior con el correo de acceso, por eso te enviamos este nuevo link para ingresar.</p><a href="${actionLink}" style="display:block;text-align:center;background:#7c3aed;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:14px 22px;margin:24px 0">Ingresar a mi portal →</a><p style="color:#9ca3af;font-size:12px;line-height:1.6">Este link expira en 24 horas. Si no esperabas este correo, puedes ignorarlo.</p></div></div></body></html>`
}

// POST /api/influencers/send-recovery-access
// Envía acceso exclusivamente a las cuentas recuperadas por la reparación de
// influencers huérfanas. No incluye el resto de la base y marca cada envío.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { dryRun?: boolean } = {}
  try { body = await req.json() } catch { /* request body is optional */ }

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId || !(await isOrgAdmin(admin, user.id, orgId))) {
    return NextResponse.json({ error: 'Solo administradores pueden enviar estos accesos' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('influencers')
    .select('id, user_id, email, display_name, metadata')
    .eq('organization_id', orgId)
    .eq('metadata->>recovery_reason', 'missing_influencer_profile')
    .is('metadata->>access_recovery_email_sent_at', null)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const targets = (data ?? []).filter((item): item is RecoveryInfluencer => Boolean(item.user_id && item.email))

  if (body.dryRun) {
    return NextResponse.json({
      dryRun: true,
      count: targets.length,
      skipped: (data?.length ?? 0) - targets.length,
      preview: targets.slice(0, 20).map(({ id, display_name, email }) => ({ id, display_name, email })),
    })
  }

  let sent = 0
  let failed = 0
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  for (const influencer of targets) {
    try {
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'magiclink', email: influencer.email!,
        options: { redirectTo: `${APP_URL}/inf-dash`, data: { is_influencer: true } },
      })
      const token = linkData?.properties?.hashed_token
      if (linkError || !token) throw new Error(linkError?.message ?? 'No se pudo generar el link de acceso')

      const actionLink = `${APP_URL}/auth/confirm?token_hash=${token}&type=magiclink&next=/inf-dash`
      const { error: emailError } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: influencer.email!,
        subject: 'Tu cuenta de SCENCE ya está lista',
        html: accessEmail(influencer.display_name ?? 'Influencer', actionLink),
      })
      if (emailError) throw new Error(emailError.message)

      const metadata = { ...(influencer.metadata ?? {}), access_recovery_email_sent_at: new Date().toISOString() }
      const { error: updateError } = await admin.from('influencers').update({ metadata }).eq('id', influencer.id)
      if (updateError) throw new Error(updateError.message)
      sent++
    } catch (sendError) {
      failed++
      console.error('[send-recovery-access] failed', influencer.id, sendError)
    }
    await sleep(150)
  }

  return NextResponse.json({ success: true, sent, failed })
}
