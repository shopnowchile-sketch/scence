import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

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

  // Verify campaign belongs to this org
  const { data: campaign } = await admin
    .from('campaigns')
    .select(`
      id, name, description, type, status, start_date, end_date, currency,
      hashtags, content_guidelines, brief,
      brand:brands!brand_id (id, name, logo_url, website, contact_name, contact_email)
    `)
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

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
    .select('id, title, type, status, due_date, platform, published_at, content_url, review_notes, progress')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer_id)
    .order('due_date', { ascending: true })

  const delivs = deliverables ?? []

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

  const STATUS: Record<string, { label: string; dot: string; bg: string; text: string }> = {
    pending:   { label: 'Pendiente',    dot: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
    in_review: { label: 'En revisión', dot: '#3b82f6', bg: '#dbeafe', text: '#1e3a8a' },
    approved:  { label: 'Aprobado',    dot: '#10b981', bg: '#d1fae5', text: '#065f46' },
    rejected:  { label: 'Rechazado',   dot: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
    published: { label: 'Publicado',   dot: '#7c3aed', bg: '#ede9fe', text: '#4c1d95' },
  }

  const approved = delivs.filter(d => d.status === 'approved' || d.status === 'published').length
  const pending  = delivs.filter(d => d.status === 'pending' || d.status === 'in_review').length
  const progress = delivs.length > 0 ? Math.round((approved / delivs.length) * 100) : 0
  const brand    = campaign!.brand as unknown as { name: string; logo_url: string | null; website: string | null; contact_name: string | null } | null
  const igProfile = (influencer.influencer_social_profiles as Array<{platform:string;username:string|null;followers:number;engagement_rate:number|null}>)?.find(s => s.platform === 'instagram')

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
  .brand-logo{height:48px;border-radius:8px;background:white;padding:5px;object-fit:contain;margin-bottom:14px;display:block}
  .brand-name{font-size:11px;font-weight:600;opacity:0.7;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px}
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
  .kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
  .kpi{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center}
  .kpi-val{font-size:24px;font-weight:900;line-height:1}
  .kpi-lbl{font-size:11px;color:#9ca3af;margin-top:3px}
  .progress-wrap{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:28px}
  .progress-label{display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#374151;margin-bottom:8px}
  .progress-bar{height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden}
  .progress-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#4338ca);border-radius:999px}
  .section{margin-bottom:28px}
  .section-title{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #f3f4f6}
  .del-card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:10px}
  .del-header{display:flex;align-items:flex-start;gap:10px;margin-bottom:6px}
  .del-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:4px}
  .del-title{font-size:14px;font-weight:700;color:#111827;flex:1}
  .del-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;flex-shrink:0}
  .del-meta{display:flex;gap:14px;font-size:12px;color:#9ca3af;flex-wrap:wrap;margin-bottom:6px;padding-left:19px}
  .del-link{padding-left:19px;font-size:12px}
  .del-link a{color:#7c3aed;font-weight:600;word-break:break-all}
  .del-notes{padding:8px 12px;background:#fafafa;border-radius:6px;font-size:12px;color:#6b7280;font-style:italic;margin-top:6px;margin-left:19px}
  .footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 48px;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af}
  .fab{position:fixed;bottom:24px;right:24px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:white;border:none;border-radius:12px;padding:13px 24px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(124,58,237,0.4)}
  @media print{body{background:white}.no-print{display:none!important}.page{max-width:100%}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      ${brand?.logo_url ? `<img src="${brand.logo_url}" class="brand-logo" alt="${brand.name}" />` : `<div class="brand-name">${brand?.name ?? ''}</div>`}
      ${brand?.logo_url ? `<div class="brand-name">${brand.name}</div>` : ''}
      <div class="campaign-name">${campaign.name}</div>
      <div class="campaign-dates">${fmt(campaign.start_date)} — ${fmt(campaign.end_date)}</div>
    </div>
    <div class="inf-card">
      ${influencer.avatar_url
        ? `<img src="${influencer.avatar_url}" class="inf-avatar" alt="${influencer.display_name}" />`
        : `<div class="inf-avatar" style="background:rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:white">${influencer.display_name.charAt(0)}</div>`}
      <div class="inf-name">${influencer.display_name}</div>
      ${igProfile?.username ? `<div class="inf-handle">@${igProfile.username}</div>` : ''}
      ${influencer.email ? `<div class="inf-stat"><span class="inf-stat-lbl">Email</span><span class="inf-stat-val" style="font-size:10px">${influencer.email}</span></div>` : ''}
      ${igProfile?.followers ? `<div class="inf-stat"><span class="inf-stat-lbl">Seguidores</span><span class="inf-stat-val">${fmtNum(igProfile.followers)}</span></div>` : ''}
      ${igProfile?.engagement_rate ? `<div class="inf-stat"><span class="inf-stat-lbl">Engagement</span><span class="inf-stat-val">${igProfile.engagement_rate.toFixed(1)}%</span></div>` : ''}
      ${membership?.fee ? `<div class="inf-stat" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.2)"><span class="inf-stat-lbl">Fee</span><span class="inf-stat-val">${fmtMoney(membership.fee, membership.currency)}</span></div>` : ''}
    </div>
  </div>

  <div class="body">
    <div class="kpi-strip">
      <div class="kpi"><div class="kpi-val">${delivs.length}</div><div class="kpi-lbl">Entregables</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#10b981">${approved}</div><div class="kpi-lbl">Aprobados</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#f59e0b">${pending}</div><div class="kpi-lbl">Pendientes</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#7c3aed">${progress}%</div><div class="kpi-lbl">Completado</div></div>
    </div>

    ${delivs.length > 0 ? `
    <div class="progress-wrap">
      <div class="progress-label"><span>Cumplimiento</span><span>${approved}/${delivs.length} entregables</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
    </div>` : ''}

    <div class="section">
      <div class="section-title">Entregables · ${delivs.length}</div>
      ${delivs.length === 0
        ? '<p style="font-size:14px;color:#9ca3af;padding:24px 0;text-align:center">Sin entregables asignados.</p>'
        : delivs.map(d => {
          const s = STATUS[d.status] ?? STATUS.pending
          return `<div class="del-card">
            <div class="del-header">
              <div class="del-dot" style="background:${s.dot}"></div>
              <div class="del-title">${d.title || d.type}</div>
              <span class="del-badge" style="background:${s.bg};color:${s.text}">${s.label}</span>
            </div>
            <div class="del-meta">
              ${d.platform ? `<span>📱 ${d.platform}</span>` : ''}
              ${d.due_date ? `<span>📅 Vence: ${fmt(d.due_date)}</span>` : ''}
              ${d.published_at ? `<span>✅ Publicado: ${fmt(d.published_at)}</span>` : ''}
            </div>
            ${d.content_url ? `<div class="del-link">🔗 <a href="${d.content_url}" target="_blank">${d.content_url}</a></div>` : ''}
            ${d.review_notes ? `<div class="del-notes">💬 ${d.review_notes}</div>` : ''}
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
