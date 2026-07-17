import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { FROM_EMAIL, getResend } from '@/lib/resend'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: { id: string } }

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function safeFilename(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'campana'
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (!validEmail(body.email)) return NextResponse.json({ error: 'Ingresa un email válido' }, { status: 400 })

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, organization_id, brand_id, created_by_brand_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  let reportPath = `/admin-campaigns/${params.id}/report`
  if (user.user_metadata?.is_brand) {
    const brandAccess = await resolveBrandAccess(user.id)
    if (!brandAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const directAccess = campaign.brand_id === brandAccess.brandId || campaign.created_by_brand_id === brandAccess.brandId
    const { data: coBrand } = directAccess ? { data: null } : await admin
      .from('campaign_brands')
      .select('campaign_id')
      .eq('campaign_id', params.id)
      .eq('brand_id', brandAccess.brandId)
      .maybeSingle()
    if (!directAccess && !coBrand) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    reportPath = `/brand-campaigns/${params.id}/report`
  } else {
    const orgId = await getOrgId(user.id, user.user_metadata, admin)
    if (!orgId || orgId !== campaign.organization_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const access = await getUserRole(user.id, orgId, admin)
    if (!access.isAdmin && access.role !== 'brand_manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let browser: Awaited<ReturnType<(typeof import('playwright-core'))['chromium']['launch']>> | null = null
  try {
    const { chromium } = await import('playwright-core')
    const launchOptions: Parameters<typeof chromium.launch>[0] = { headless: true }
    if (process.env.VERCEL) {
      const chromiumBinary = (await import('@sparticuz/chromium')).default
      launchOptions.args = chromiumBinary.args
      launchOptions.executablePath = await chromiumBinary.executablePath()
    }
    browser = await chromium.launch(launchOptions)
    const page = await browser.newPage({
      extraHTTPHeaders: { cookie: req.headers.get('cookie') ?? '' },
    })
    const reportUrl = new URL(reportPath, req.url).toString()
    await page.goto(reportUrl, { waitUntil: 'networkidle', timeout: 45_000 })
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' } })

    const { error: emailError } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: body.email,
      subject: `Reporte final — ${campaign.name}`,
      html: `<div style="font-family:Arial,sans-serif;color:#111827"><h2>Reporte final de campaña</h2><p>Adjuntamos el reporte final de <strong>${campaign.name}</strong>, con sus KPI y resultados.</p><p style="color:#6b7280;font-size:12px">SCENCE</p></div>`,
      attachments: [{
        filename: `reporte-${safeFilename(campaign.name)}.pdf`,
        content: Buffer.from(pdf).toString('base64'),
      }],
    })
    if (emailError) return NextResponse.json({ error: 'No se pudo enviar el email' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[campaign report email]', error)
    return NextResponse.json({ error: 'No se pudo generar o enviar el PDF' }, { status: 500 })
  } finally {
    await browser?.close().catch(() => undefined)
  }
}
