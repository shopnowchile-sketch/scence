import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return new NextResponse('No autorizado', { status: 401 })
  }

  const admin = createAdminClient()

  // Get influencer profile
  const { data: influencer } = await admin
    .from('influencers')
    .select(`
      id, display_name, avatar_url, email, phone, city, country,
      influencer_social_profiles (platform, username, followers, engagement_rate)
    `)
    .eq('user_id', user.id)
    .single()

  if (!influencer) return new NextResponse('No eres influencer', { status: 403 })

  // Get membership + fee
  const { data: membership } = await admin
    .from('campaign_influencers')
    .select('id, fee, currency, status, notes')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .single()

  if (!membership) return new NextResponse('No tienes acceso a esta campaña', { status: 403 })

  // Get campaign + brand
  const { data: campaign, error } = await admin
    .from('campaigns')
    .select(`
      id, name, description, type, status, start_date, end_date,
      currency, hashtags, platforms, content_guidelines, brief,
      brand:brands!brand_id (id, name, logo_url, website, contact_name, contact_email)
    `)
    .eq('id', params.id)
    .single()

  if (error || !campaign) return new NextResponse('Campaña no encontrada', { status: 404 })
  const camp = campaign!

  // Get ONLY this influencer's deliverables
  const { data: deliverables } = await admin
    .from('campaign_deliverables')
    .select('id, title, type, status, due_date, platform, published_at, content_url, review_notes, progress')
    .eq('campaign_id', params.id)
    .eq('influencer_id', influencer.id)
    .order('due_date', { ascending: true })

  const delivs = deliverables ?? []

  // Helpers
  function fmt(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  function fmtMoney(n: number, cur?: string) {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: cur ?? camp.currency ?? 'CLP', minimumFractionDigits: 0
    }).format(n)
  }
  function fmtNum(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
    return n.toString()
  }

  const STATUS: Record<string, { label: string; dot: string; bg: string; text: string }> = {
    pending:    { label: 'Pendiente',    dot: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
    in_review:  { label: 'En revisión', dot: '#3b82f6', bg: '#dbeafe', text: '#1e3a8a' },
    approved:   { label: 'Aprobado',    dot: '#10b981', bg: '#d1fae5', text: '#065f46' },
    rejected:   { label: 'Rechazado',   dot: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
    published:  { label: 'Publicado',   dot: '#7c3aed', bg: '#ede9fe', text: '#4c1d95' },
  }

  const CAMP_STATUS: Record<string, string> = {
    active: 'Activa', completed: 'Completada', draft: 'Borrador', paused: 'Pausada',
  }

  const approved = delivs.filter(d => d.status === 'approved' || d.status === 'published').length
  const pending  = delivs.filter(d => d.status === 'pending' || d.status === 'in_review').length
  const progress = delivs.length > 0 ? Math.round((approved / delivs.length) * 100) : 0

  const igProfile = (influencer.influencer_social_profiles as Array<{platform:string;username:string|null;followers:number;engagement_rate:number|null}>)
    ?.find(s => s.platform === 'instagram')

  const brand = camp.brand as unknown as { name: string; logo_url: string | null; website: string | null; contact_name: string | null; contact_email: string | null } | null

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte — ${camp.name} · ${influencer.display_name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;background:#f3f4f6;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:800px;margin:0 auto;background:white}

  /* Header */
  .header{background:linear-gradient(135deg,#7c3aed 0%,#4338ca 100%);padding:40px 48px;color:white;display:flex;align-items:flex-start;gap:24px}
  .header-left{flex:1}
  .brand-logo{height:52px;border-radius:10px;background:white;padding:6px;object-fit:contain;margin-bottom:16px;display:block}
  .brand-name{font-size:12px;font-weight:600;opacity:0.7;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px}
  .campaign-name{font-size:28px;font-weight:900;line-height:1.1;margin-bottom:8px}
  .campaign-dates{font-size:13px;opacity:0.8}
  .camp-badge{display:inline-block;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;margin-top:8px}

  /* Influencer card */
  .inf-card{background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:16px;padding:20px;min-width:220px;flex-shrink:0}
  .inf-avatar{width:56px;height:56px;border-radius:999px;border:3px solid rgba(255,255,255,0.4);object-fit:cover;margin-bottom:12px;display:block}
  .inf-avatar-placeholder{width:56px;height:56px;border-radius:999px;background:rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white;margin-bottom:12px}
  .inf-name{font-size:16px;font-weight:800;color:white;margin-bottom:2px}
  .inf-handle{font-size:12px;opacity:0.75;margin-bottom:10px}
  .inf-stat{display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px}
  .inf-stat-val{font-weight:700;color:white}
  .inf-stat-lbl{opacity:0.7}

  /* Body */
  .body{padding:40px 48px}

  /* KPI strip */
  .kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
  .kpi{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center}
  .kpi-val{font-size:28px;font-weight:900;color:#111827;line-height:1}
  .kpi-lbl{font-size:11px;color:#9ca3af;margin-top:4px;font-weight:500}

  /* Progress bar */
  .progress-wrap{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:32px}
  .progress-label{display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#374151;margin-bottom:10px}
  .progress-bar{height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden}
  .progress-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#4338ca);border-radius:999px;transition:width 0.3s}

  /* Section */
  .section{margin-bottom:32px}
  .section-title{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #f3f4f6}

  /* Info rows */
  .info-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f9fafb;font-size:14px}
  .info-row:last-child{border-bottom:none}
  .info-k{color:#6b7280}
  .info-v{font-weight:600;color:#111827;text-align:right;max-width:65%;word-break:break-word}

  /* Deliverable cards */
  .del-card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:12px}
  .del-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:8px}
  .del-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:4px}
  .del-title{font-size:15px;font-weight:700;color:#111827;flex:1}
  .del-badge{font-size:10px;font-weight:700;padding:3px 10px;border-radius:999px;flex-shrink:0}
  .del-meta{display:flex;gap:16px;font-size:12px;color:#9ca3af;flex-wrap:wrap;margin-bottom:8px;padding-left:22px}
  .del-link{padding-left:22px;font-size:13px}
  .del-link a{color:#7c3aed;font-weight:600;word-break:break-all}
  .del-notes{padding-left:22px;margin-top:8px;background:#fafafa;border-radius:8px;padding:10px 10px 10px 22px;font-size:12px;color:#6b7280;font-style:italic}

  /* Social chips */
  .socials{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .social-chip{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:8px 14px;font-size:12px;display:flex;align-items:center;gap:8px}
  .social-chip strong{color:#111827;font-weight:700}
  .social-chip span{color:#9ca3af}

  /* Footer */
  .footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 48px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9ca3af}

  /* Print */
  @media print{
    body{background:white}
    .no-print{display:none!important}
    .page{max-width:100%;box-shadow:none}
    .del-card{break-inside:avoid}
    .header{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .progress-fill{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }

  /* Print button */
  .fab{position:fixed;bottom:24px;right:24px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:white;border:none;border-radius:16px;padding:14px 28px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 24px rgba(124,58,237,0.4);display:flex;align-items:center;gap:8px;z-index:100}
  .fab:hover{transform:translateY(-1px);box-shadow:0 6px 28px rgba(124,58,237,0.5)}
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      ${brand?.logo_url ? `<img src="${brand.logo_url}" class="brand-logo" alt="${brand.name}" />` : `<div class="brand-name">${brand?.name ?? 'Marca'}</div>`}
      ${brand?.logo_url ? `<div class="brand-name">${brand.name}</div>` : ''}
      <div class="campaign-name">${camp.name}</div>
      <div class="campaign-dates">${fmt(camp.start_date)} — ${fmt(camp.end_date)}</div>
      <span class="camp-badge">${CAMP_STATUS[camp.status] ?? camp.status}</span>
    </div>

    <!-- Influencer card -->
    <div class="inf-card">
      ${influencer.avatar_url
        ? `<img src="${influencer.avatar_url}" class="inf-avatar" alt="${influencer.display_name}" />`
        : `<div class="inf-avatar-placeholder">${influencer.display_name.charAt(0).toUpperCase()}</div>`}
      <div class="inf-name">${influencer.display_name}</div>
      ${igProfile?.username ? `<div class="inf-handle">@${igProfile.username}</div>` : ''}
      ${igProfile?.followers ? `
      <div class="inf-stat">
        <span class="inf-stat-lbl">Seguidores</span>
        <span class="inf-stat-val">${fmtNum(igProfile.followers)}</span>
      </div>` : ''}
      ${igProfile?.engagement_rate ? `
      <div class="inf-stat">
        <span class="inf-stat-lbl">Engagement</span>
        <span class="inf-stat-val">${igProfile.engagement_rate.toFixed(1)}%</span>
      </div>` : ''}
      ${membership.fee ? `
      <div class="inf-stat" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.2)">
        <span class="inf-stat-lbl">Fee</span>
        <span class="inf-stat-val">${fmtMoney(membership.fee, membership.currency)}</span>
      </div>` : ''}
    </div>
  </div>

  <!-- Body -->
  <div class="body">

    <!-- KPIs -->
    <div class="kpi-strip">
      <div class="kpi">
        <div class="kpi-val">${delivs.length}</div>
        <div class="kpi-lbl">Entregables</div>
      </div>
      <div class="kpi">
        <div class="kpi-val" style="color:#10b981">${approved}</div>
        <div class="kpi-lbl">Aprobados</div>
      </div>
      <div class="kpi">
        <div class="kpi-val" style="color:#f59e0b">${pending}</div>
        <div class="kpi-lbl">Pendientes</div>
      </div>
      <div class="kpi">
        <div class="kpi-val" style="color:#7c3aed">${progress}%</div>
        <div class="kpi-lbl">Completado</div>
      </div>
    </div>

    <!-- Progress -->
    ${delivs.length > 0 ? `
    <div class="progress-wrap">
      <div class="progress-label">
        <span>Avance de campaña</span>
        <span>${approved} de ${delivs.length} entregables completados</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${progress}%"></div>
      </div>
    </div>` : ''}

    <!-- Campaign info -->
    <div class="section">
      <div class="section-title">Información de campaña</div>
      ${camp.description ? `<div class="info-row"><span class="info-k">Descripción</span><span class="info-v">${camp.description}</span></div>` : ''}
      <div class="info-row"><span class="info-k">Período</span><span class="info-v">${fmt(camp.start_date)} — ${fmt(camp.end_date)}</span></div>
      ${camp.type ? `<div class="info-row"><span class="info-k">Tipo</span><span class="info-v">${camp.type}</span></div>` : ''}
      ${brand?.contact_name ? `<div class="info-row"><span class="info-k">Contacto en marca</span><span class="info-v">${brand.contact_name}${brand.contact_email ? ` · ${brand.contact_email}` : ''}</span></div>` : ''}
      ${brand?.website ? `<div class="info-row"><span class="info-k">Sitio web</span><span class="info-v">${brand.website}</span></div>` : ''}
    </div>

    <!-- Brief -->
    ${camp.content_guidelines || (camp as {brief?:string|null}).brief ? `
    <div class="section">
      <div class="section-title">Brief y lineamientos</div>
      <div style="font-size:14px;color:#374151;line-height:1.7;white-space:pre-line">${(camp as {brief?:string|null}).brief ?? camp.content_guidelines}</div>
    </div>` : ''}

    <!-- Hashtags -->
    ${Array.isArray(camp.hashtags) && camp.hashtags.length > 0 ? `
    <div class="section">
      <div class="section-title">Hashtags</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${(camp.hashtags as string[]).map(h => `<span style="background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px">${h.startsWith('#') ? h : '#'+h}</span>`).join('')}
      </div>
    </div>` : ''}

    <!-- Deliverables -->
    <div class="section">
      <div class="section-title">Entregables · ${delivs.length} total</div>
      ${delivs.length === 0
        ? '<p style="font-size:14px;color:#9ca3af;text-align:center;padding:32px 0">No tienes entregables asignados aún.</p>'
        : delivs.map(d => {
          const s = STATUS[d.status] ?? STATUS.pending
          return `
          <div class="del-card">
            <div class="del-header">
              <div class="del-dot" style="background:${s.dot}"></div>
              <div class="del-title">${d.title || d.type}</div>
              <span class="del-badge" style="background:${s.bg};color:${s.text}">${s.label}</span>
            </div>
            <div class="del-meta">
              ${d.platform ? `<span>📱 ${d.platform}</span>` : ''}
              ${d.due_date ? `<span>📅 Vence: ${fmt(d.due_date)}</span>` : ''}
              ${d.published_at ? `<span>✅ Publicado: ${fmt(d.published_at)}</span>` : ''}
              ${d.progress != null && d.progress > 0 ? `<span>⏳ Progreso: ${d.progress}%</span>` : ''}
            </div>
            ${d.content_url ? `<div class="del-link">🔗 <a href="${d.content_url}" target="_blank">${d.content_url}</a></div>` : ''}
            ${d.review_notes ? `<div class="del-notes">💬 ${d.review_notes}</div>` : ''}
          </div>`
        }).join('')}
    </div>

    <!-- Social profiles -->
    ${(influencer.influencer_social_profiles as Array<{platform:string;username:string|null;followers:number;engagement_rate:number|null}>)?.length > 0 ? `
    <div class="section">
      <div class="section-title">Redes sociales</div>
      <div class="socials">
        ${(influencer.influencer_social_profiles as Array<{platform:string;username:string|null;followers:number;engagement_rate:number|null}>)
          .filter(s => s.username)
          .map(s => `
          <div class="social-chip">
            <strong>${s.platform.charAt(0).toUpperCase() + s.platform.slice(1)}</strong>
            <span>@${s.username}</span>
            ${s.followers > 0 ? `<span>· ${fmtNum(s.followers)}</span>` : ''}
            ${s.engagement_rate ? `<span>· ${s.engagement_rate.toFixed(1)}%</span>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''}

  </div><!-- /body -->

  <!-- Footer -->
  <div class="footer no-print" style="display:flex">
    <span>Generado por Scence</span>
    <span>${influencer.display_name} · ${camp.name}</span>
    <span>${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
  </div>
  <div class="footer" style="display:none" id="print-footer">
    <span>Generado por Scence · ${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
    <span>${influencer.display_name} · ${camp.name}</span>
  </div>

</div><!-- /page -->

<button class="fab no-print" onclick="document.getElementById('print-footer').style.display='flex';window.print()">
  ⬇ Descargar PDF
</button>

<script>
  window.addEventListener('afterprint', () => {
    document.getElementById('print-footer').style.display = 'none'
  })
</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-cache',
    },
  })
}
