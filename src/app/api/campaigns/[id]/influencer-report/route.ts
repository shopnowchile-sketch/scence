import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

type Params = { params: { id: string } }

// GET /api/campaigns/[id]/influencer-report?influencer_id=xxx
// Admin endpoint: returns HTML report for a specific influencer in the campaign
export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return new NextResponse('No autorizado', { status: 401 })

  const influencer_id = new URL(req.url).searchParams.get('influencer_id')
  if (!influencer_id) return new NextResponse('influencer_id requerido', { status: 400 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)

  // admin/super_admin/owner de Scence puede generar el reporte de cualquier
  // campaña, sin filtrar por organization_id. Mismo criterio que /api/campaigns/[id].
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }

  let campaignQuery = admin
    .from('campaigns')
    .select(`
      id, name, description, type, status, start_date, end_date, currency,
      content_guidelines
    `)
    .eq('id', params.id)

  if (!isAdmin) campaignQuery = campaignQuery.eq('organization_id', orgId)

  const { data: campaign } = await campaignQuery.single()

  if (!campaign) return new NextResponse('Campaña no encontrada', { status: 404 })

  // Get influencer + membership
  const [{ data: influencer }, { data: membership }] = await Promise.all([
    admin.from('influencers').select(`
      id, display_name, avatar_url, email, phone, city, country,
      influencer_social_profiles (platform, username, followers, engagement_rate)
    `).eq('id', influencer_id).single(),
    admin.from('campaign_influencers').select('fee, currency, status, notes')
      .eq('campaign_id', params.id).eq('influencer_id', influencer_id).single(),
  ])

  if (!influencer) return new NextResponse('Influencer no encontrado', { status: 404 })

  // Get influencer's deliverables
  const { data: deliverables } = await admin
    .from('campaign_deliverables')
    .select('id, title, type, status, due_date, platform, published_at, content_url, published_url, review_notes, progress')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id)
    .order('due_date', { ascending: true })

  const delivs = deliverables ?? []

  // Etiqueta corta por tipo — "Reel: URL" / "Story 1: URL" (numerado solo si
  // hay más de uno del mismo tipo). Mismo criterio que el reporte de campaña.
  const DELIVERABLE_SHORT_LABELS: Record<string, string> = {
    instagram_reel: 'Reel', instagram_story: 'Story', instagram_post: 'Post',
    tiktok: 'TikTok', youtube: 'YouTube', youtube_short: 'YouTube Short',
    blog: 'Blog', podcast: 'Podcast', event_appearance: 'Evento',
    live_stream: 'Live', ugc_video: 'UGC Video', ugc_photo: 'UGC Foto',
  }
  function shortLabel(type: string | null) {
    if (!type) return 'Deliverable'
    return DELIVERABLE_SHORT_LABELS[type] ?? type.replace(/_/g, ' ')
  }
  const byType = new Map<string, typeof delivs>()
  for (const d of delivs) {
    const key = d.type ?? '—'
    if (!byType.has(key)) byType.set(key, [])
    byType.get(key)!.push(d)
  }
  const labeledDeliverables: Array<{ label: string; d: typeof delivs[number] }> = []
  Array.from(byType.entries()).forEach(([type, group]) => {
    const base = shortLabel(type === '—' ? null : type)
    group.forEach((d: typeof delivs[number], idx: number) =>
      labeledDeliverables.push({ label: group.length > 1 ? `${base} ${idx + 1}` : base, d }))
  })

  const uploadedDates = delivs.map(d => d.published_at).filter(Boolean) as string[]
  const lastUploaded = uploadedDates.length > 0
    ? uploadedDates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
    : null

  function fmt(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  function fmtMoney(n: number, cur?: string) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: cur ?? campaign!.currency ?? 'CLP', minimumFractionDigits: 0 }).format(n)
  }
  function fmtNum(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
    return n.toString()
  }

  const published = delivs.filter(d => d.status === 'published').length
  const progress  = delivs.length > 0 ? Math.round((published / delivs.length) * 100) : 0
  const igProfile = (influencer.influencer_social_profiles as Array<{platform:string;username:string|null;followers:number;engagement_rate:number|null}>)?.find(s => s.platform === 'instagram')
  const hasBrief  = !!(campaign!.description || campaign!.content_guidelines)

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte — ${influencer.display_name} · ${campaign.name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:800px;margin:0 auto;background:white}
  .header{background:linear-gradient(135deg,#7c3aed,#4338ca);padding:40px 48px;color:white;display:flex;align-items:flex-start;gap:24px}
  .header-left{flex:1}
  .campaign-name{font-size:26px;font-weight:900;line-height:1.1;margin-bottom:6px}
  .campaign-dates{font-size:13px;opacity:0.8}
  .inf-card{background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:14px;padding:20px;min-width:210px;flex-shrink:0}
  .inf-avatar{width:52px;height:52px;border-radius:999px;border:2px solid rgba(255,255,255,0.4);object-fit:cover;margin-bottom:10px;display:block}
  .inf-name{font-size:15px;font-weight:800;color:white;margin-bottom:2px}
  .inf-handle{font-size:12px;opacity:0.7;margin-bottom:8px}
  .inf-stat{display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px}
  .inf-stat-val{font-weight:700;color:white}
  .inf-stat-lbl{opacity:0.7}
  .body{padding:36px 48px}
  .brief-box{font-size:13px;color:#4b5563;line-height:1.7;background:#f9fafb;border:1px solid #f0f0f0;border-radius:8px;padding:14px 16px}
  .brief-box + .brief-box{margin-top:10px}
  .brief-subtitle{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px}
  .summary-row{display:flex;gap:14px;margin-bottom:28px}
  .summary-card{flex:1;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center}
  .summary-val{font-size:22px;font-weight:900;line-height:1;color:#7c3aed}
  .summary-lbl{font-size:11px;color:#9ca3af;margin-top:3px}
  .section{margin-bottom:28px}
  .section-title{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #f3f4f6}
  .deliverable-row{display:flex;align-items:baseline;gap:8px;font-size:13px;padding:8px 0;border-bottom:1px dashed #f3f4f6}
  .deliverable-row:last-child{border-bottom:none}
  .deliverable-label{font-weight:700;color:#374151;min-width:100px;flex-shrink:0}
  .deliverable-link{color:#7c3aed;font-weight:600;word-break:break-all;text-decoration:none}
  .deliverable-pending{color:#d1d5db;font-style:italic}
  .footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 48px;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af}
  .fab{position:fixed;bottom:24px;right:24px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:white;border:none;border-radius:12px;padding:13px 24px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(124,58,237,0.4)}
  @media print{body{background:white}.no-print{display:none!important}.page{max-width:100%}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      <div class="campaign-name">${campaign.name}</div>
      <div class="campaign-dates">${fmt(campaign.start_date)} — ${fmt(campaign.end_date)}</div>
    </div>
    <div class="inf-card">
      ${influencer.avatar_url
        ? `<img src="${influencer.avatar_url}" class="inf-avatar" alt="${influencer.display_name}" />`
        : `<div class="inf-avatar" style="background:rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:white">${influencer.display_name.charAt(0)}</div>`}
      <div class="inf-name">${influencer.display_name}</div>
      ${igProfile?.username ? `<div class="inf-handle">@${igProfile.username}</div>` : ''}
      ${igProfile?.followers ? `<div class="inf-stat"><span class="inf-stat-lbl">Seguidores</span><span class="inf-stat-val">${fmtNum(igProfile.followers)}</span></div>` : ''}
      ${membership?.fee ? `<div class="inf-stat" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.2)"><span class="inf-stat-lbl">Fee</span><span class="inf-stat-val">${fmtMoney(membership.fee, membership.currency)}</span></div>` : ''}
    </div>
  </div>

  <div class="body">
    ${hasBrief ? `
    <div class="section">
      <div class="section-title">Brief de la Campaña</div>
      ${campaign!.description ? `<div class="brief-box">${campaign!.content_guidelines ? '<div class="brief-subtitle">Descripción</div>' : ''}${campaign!.description}</div>` : ''}
      ${campaign!.content_guidelines ? `<div class="brief-box"><div class="brief-subtitle">Lineamientos de contenido</div>${campaign!.content_guidelines}</div>` : ''}
    </div>` : ''}

    <div class="summary-row">
      <div class="summary-card"><div class="summary-val" style="font-size:16px">${igProfile?.username ? '@' + igProfile.username : 'Instagram'}</div><div class="summary-lbl">Red social</div></div>
      <div class="summary-card"><div class="summary-val">${progress}%</div><div class="summary-lbl">Completado</div></div>
      <div class="summary-card"><div class="summary-val" style="font-size:15px">${lastUploaded ? fmt(lastUploaded) : 'Pendiente'}</div><div class="summary-lbl">Contenido subido</div></div>
    </div>

    <div class="section">
      <div class="section-title">Deliverables · ${delivs.length}</div>
      ${labeledDeliverables.length === 0
        ? '<p style="font-size:14px;color:#9ca3af;padding:24px 0;text-align:center">Sin entregables asignados.</p>'
        : labeledDeliverables.map(({ label, d }) => {
          const url = d.content_url || d.published_url
          return `<div class="deliverable-row">
            <span class="deliverable-label">${label}:</span>
            ${url ? `<a href="${url}" target="_blank" class="deliverable-link">${url}</a>` : '<span class="deliverable-pending">Pendiente</span>'}
          </div>`
        }).join('')}
    </div>
  </div>

  <div class="footer no-print">
    <span>Scence · Reporte de influencer</span>
    <span>${influencer.display_name} · ${campaign.name}</span>
    <span>${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
  </div>
</div>

<button class="fab no-print" onclick="window.print()">⬇ Descargar PDF</button>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache' },
  })
}
