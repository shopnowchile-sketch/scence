import { notFound } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────
interface Influencer {
  id: string
  display_name: string
  avatar_url: string | null
  city: string | null
  country: string | null
  influencer_social_profiles: Array<{
    platform: string
    username: string | null
    followers: number
    engagement_rate: number | null
  }>
}

interface CampaignInfluencer {
  id: string
  fee: number | null
  status: string | null
  notes: string | null
  influencer: Influencer | null
}

interface Deliverable {
  id: string
  title: string
  type: string | null
  status: string
  due_date: string | null
  platform: string | null
  published_at: string | null
  published_url: string | null
  content_url: string | null
  review_notes: string | null
  progress: number | null
  // Métricas reales (Apify) — solo views/likes/comments. reach/impressions/
  // saves/shares no existen, no se inventan (ver src/lib/deliverables/apify-metrics.ts).
  performance: { views: number | null; likes: number | null; comments: number | null } | null
  engagement_rate: number | null // CALCULADO, no dato real de Instagram
  influencer: { id: string; display_name: string; avatar_url: string | null } | null
}

interface CampaignReport {
  id: string
  name: string
  description: string | null
  type: string
  status: string
  start_date: string | null
  end_date: string | null
  budget_total: number | null
  budget_spent: number
  currency: string
  hashtags: string[]
  platforms: string[]
  content_guidelines: string | null
  campaign_influencers: CampaignInfluencer[]
  campaign_deliverables: Deliverable[]
  created_at: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtCurrency(amount: number, currency = 'CLP') {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending_approval: 'En aprobación',
  active: 'Activa',
  paused: 'Pausada',
  completed: 'Completada',
  canceled: 'Cancelada',
}

const TYPE_LABELS: Record<string, string> = {
  sponsored_post: 'Post patrocinado',
  event_appearance: 'Aparición en evento',
  ambassador: 'Embajador',
  product_seeding: 'Producto seeding',
  ugc: 'UGC',
  live: 'Live',
}

// Etiqueta corta por tipo de deliverable — usada para "Reel: URL", "Story 1: URL", etc.
const DELIVERABLE_SHORT_LABELS: Record<string, string> = {
  instagram_reel: 'Reel',
  instagram_story: 'Story',
  instagram_post: 'Post',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  youtube_short: 'YouTube Short',
  blog: 'Blog',
  podcast: 'Podcast',
  event_appearance: 'Evento',
  live_stream: 'Live',
  ugc_video: 'UGC Video',
  ugc_photo: 'UGC Foto',
}

function deliverableShortLabel(type: string | null) {
  if (!type) return 'Deliverable'
  return DELIVERABLE_SHORT_LABELS[type] ?? type.replace(/_/g, ' ')
}

function formatFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

// Agrupa los deliverables de un influencer por tipo y les asigna numeración
// solo cuando hay más de uno del mismo tipo (Reel: URL / Story 1: URL / Story 2: URL).
function labelDeliverables(items: Deliverable[]): Array<{ label: string; deliverable: Deliverable }> {
  const byType = new Map<string, Deliverable[]>()
  for (const d of items) {
    const key = d.type ?? '—'
    if (!byType.has(key)) byType.set(key, [])
    byType.get(key)!.push(d)
  }
  const result: Array<{ label: string; deliverable: Deliverable }> = []
  Array.from(byType.entries()).forEach(([type, group]) => {
    const base = deliverableShortLabel(type === '—' ? null : type)
    group.forEach((d: Deliverable, idx: number) => {
      result.push({ label: group.length > 1 ? `${base} ${idx + 1}` : base, deliverable: d })
    })
  })
  return result
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchReport(id: string): Promise<CampaignReport | null> {
  // Query Supabase directly — avoids Server Component → API route fetch issues on Vercel
  const { createAdminClient } = await import('@/lib/supabase/server')
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('campaigns')
    .select(`
      *,
      campaign_influencers (
        id, fee, status, notes,
        influencer:influencers (
          id, display_name, avatar_url, city, country,
          influencer_social_profiles (platform, username, followers, engagement_rate)
        )
      ),
      campaign_deliverables (
        id, title, type, status, due_date, platform,
        published_at, published_url, review_notes, progress, content_url,
        performance, engagement_rate,
        influencer:influencers (id, display_name, avatar_url)
      )
    `)
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as unknown as CampaignReport
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function CampaignReportPage({ params }: { params: { id: string } }) {
  const campaign = await fetchReport(params.id)
  if (!campaign) notFound()

  const influencers = campaign.campaign_influencers ?? []
  const deliverables = campaign.campaign_deliverables ?? []

  const totalDone = deliverables.filter(d => d.status === 'published').length
  const totalCount = deliverables.length
  const progressPct = totalCount > 0 ? Math.round((totalDone / totalCount) * 100) : 0

  // Métricas reales de contenido (Apify) — solo se suman deliverables que ya
  // tienen una sync guardada en `performance`. reach/impressions/saves/shares
  // NO se muestran porque no existen (ver src/lib/deliverables/apify-metrics.ts).
  const deliverablesWithMetrics = deliverables.filter(d => d.performance != null)
  const hasMetrics = deliverablesWithMetrics.length > 0
  const totalViews = deliverablesWithMetrics.reduce((s, d) => s + (d.performance?.views ?? 0), 0)
  const totalLikes = deliverablesWithMetrics.reduce((s, d) => s + (d.performance?.likes ?? 0), 0)
  const totalComments = deliverablesWithMetrics.reduce((s, d) => s + (d.performance?.comments ?? 0), 0)
  const totalInteractions = totalLikes + totalComments
  const engagementRates = deliverablesWithMetrics.map(d => d.engagement_rate).filter((v): v is number => v != null)
  const avgEngagementRate = engagementRates.length > 0
    ? Math.round((engagementRates.reduce((s, v) => s + v, 0) / engagementRates.length) * 100) / 100
    : null

  const showBudgetTotal = campaign.budget_total != null && campaign.budget_total > 0
  const showBudgetSpent = (campaign.budget_spent ?? 0) > 0

  const hasBrief = !!(campaign.description || campaign.content_guidelines)

  const today = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; color: #1a1a2e; }
        .page { background: white; max-width: 900px; margin: 0 auto; padding: 0; }

        /* Print */
        @media print {
          body { background: white; }
          .page { max-width: 100%; box-shadow: none; }
          .no-print { display: none !important; }
          .section { page-break-inside: avoid; }
          .inf-card { page-break-inside: avoid; }
        }

        /* Top bar */
        .header-bar { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); padding: 32px 40px; color: white; }
        .header-bar .brand-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .scence-logo { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
        .scence-logo span { opacity: 0.7; font-weight: 400; }
        .report-meta { text-align: right; font-size: 12px; opacity: 0.8; }
        .campaign-title { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
        .campaign-badges { display: flex; gap: 8px; flex-wrap: wrap; }
        .badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .badge-white { background: rgba(255,255,255,0.2); color: white; }
        .badge-status { background: rgba(255,255,255,0.95); color: #7c3aed; }

        /* Body */
        .body { padding: 32px 40px; }

        /* Section */
        .section { margin-bottom: 32px; }
        .section-title { font-size: 13px; font-weight: 700; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #ede9fe; }

        /* Brief */
        .brief-box { font-size: 13px; color: #4b5563; line-height: 1.7; background: #f9fafb; border: 1px solid #f0f0f0; border-radius: 8px; padding: 14px 16px; }
        .brief-box + .brief-box { margin-top: 10px; }
        .brief-subtitle { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }

        /* Info grid */
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
        .info-card { background: #fafafa; border: 1px solid #f0f0f0; border-radius: 10px; padding: 14px 16px; }
        .info-label { font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .info-value { font-size: 15px; font-weight: 700; color: #1a1a2e; }

        /* Progress bar */
        .progress-summary { display: flex; align-items: center; gap: 20px; background: #f9f7ff; border: 1px solid #ede9fe; border-radius: 10px; padding: 16px 20px; }
        .progress-number { font-size: 36px; font-weight: 800; color: #7c3aed; line-height: 1; }
        .progress-label { font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
        .progress-bar-wrap { flex: 1; }
        .progress-bar-track { height: 10px; background: #ede9fe; border-radius: 6px; overflow: hidden; margin-bottom: 6px; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #a78bfa); border-radius: 6px; transition: width 0.3s; }
        .progress-stats { font-size: 12px; color: #6b7280; }

        /* Influencer card (por-influencer, reemplaza las 2 tablas separadas) */
        .inf-card { border: 1px solid #f0f0f0; border-radius: 10px; margin-bottom: 14px; overflow: hidden; }
        .inf-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fafafa; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; flex-wrap: wrap; }
        .inf-name { font-size: 14px; font-weight: 700; color: #1a1a2e; }
        .inf-meta { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .inf-pct { font-size: 13px; font-weight: 700; color: #7c3aed; background: #f3f0ff; padding: 4px 12px; border-radius: 20px; flex-shrink: 0; }
        .inf-body { padding: 12px 16px; }
        .inf-uploaded { font-size: 12px; color: #6b7280; margin-bottom: 10px; }
        .deliverable-row { display: flex; align-items: baseline; gap: 6px; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed #f3f4f6; }
        .deliverable-row:last-child { border-bottom: none; }
        .deliverable-label { font-weight: 600; color: #374151; min-width: 90px; flex-shrink: 0; }
        .deliverable-link { color: #7c3aed; font-weight: 600; text-decoration: none; word-break: break-all; }
        .deliverable-pending { color: #d1d5db; font-style: italic; }

        /* Footer */
        .footer { background: #1a1a2e; color: white; padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; }
        .footer-logo { font-size: 14px; font-weight: 800; letter-spacing: -0.3px; }
        .footer-text { font-size: 11px; opacity: 0.5; }

        /* Print button */
        .print-btn { position: fixed; bottom: 24px; right: 24px; background: #7c3aed; color: white; border: none; border-radius: 12px; padding: 12px 24px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 20px rgba(124,58,237,0.4); z-index: 100; display: flex; align-items: center; gap: 8px; }
        .print-btn:hover { background: #6d28d9; }
      `}</style>

      {/* Print button */}
      <button className="print-btn no-print" id="printBtn">
        ⬇ Descargar PDF
      </button>

      <div className="page">
        {/* Header */}
        <div className="header-bar">
          <div className="brand-row">
            <div className="scence-logo">SCENCE <span>Agency</span></div>
            <div className="report-meta">
              <div>Reporte de Campaña</div>
              <div>Generado el {today}</div>
            </div>
          </div>
          <div className="campaign-title">{campaign.name}</div>
          <div className="campaign-badges">
            <span className="badge badge-status">{STATUS_LABELS[campaign.status] ?? campaign.status}</span>
            <span className="badge badge-white">{TYPE_LABELS[campaign.type] ?? campaign.type.replace(/_/g, ' ')}</span>
            {campaign.platforms?.map(p => (
              <span key={p} className="badge badge-white">{p}</span>
            ))}
          </div>
        </div>

        <div className="body">

          {/* Brief / lineamientos — primero, como pide el nuevo orden */}
          {hasBrief && (
            <div className="section">
              <div className="section-title">Brief de la Campaña</div>
              {campaign.description && (
                <div className="brief-box">
                  {campaign.content_guidelines && <div className="brief-subtitle">Descripción</div>}
                  {campaign.description}
                </div>
              )}
              {campaign.content_guidelines && (
                <div className="brief-box">
                  <div className="brief-subtitle">Lineamientos de contenido</div>
                  {campaign.content_guidelines}
                </div>
              )}
            </div>
          )}

          {/* Campaign Info — presupuesto oculto si es 0 o no está definido */}
          <div className="section">
            <div className="section-title">Información de la Campaña</div>
            <div className="info-grid">
              <div className="info-card">
                <div className="info-label">Fecha de inicio</div>
                <div className="info-value">{fmtDate(campaign.start_date)}</div>
              </div>
              <div className="info-card">
                <div className="info-label">Fecha de cierre</div>
                <div className="info-value">{fmtDate(campaign.end_date)}</div>
              </div>
              {showBudgetTotal && (
                <div className="info-card">
                  <div className="info-label">Presupuesto total</div>
                  <div className="info-value" style={{ color: '#7c3aed' }}>
                    {fmtCurrency(campaign.budget_total as number, campaign.currency)}
                  </div>
                </div>
              )}
              {showBudgetSpent && (
                <div className="info-card">
                  <div className="info-label">Presupuesto ejecutado</div>
                  <div className="info-value">{fmtCurrency(campaign.budget_spent, campaign.currency)}</div>
                </div>
              )}
              <div className="info-card">
                <div className="info-label">Influencers</div>
                <div className="info-value">{influencers.length}</div>
              </div>
              <div className="info-card">
                <div className="info-label">Deliverables</div>
                <div className="info-value">{deliverables.length}</div>
              </div>
            </div>
          </div>

          {/* Progress Summary — avance agregado de toda la campaña */}
          <div className="section">
            <div className="section-title">Avance de la Campaña</div>
            <div className="progress-summary">
              <div>
                <div className="progress-number">{progressPct}%</div>
                <div className="progress-label">Completado</div>
              </div>
              <div className="progress-bar-wrap">
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="progress-stats">
                  {totalDone} de {totalCount} deliverables publicados
                </div>
              </div>
            </div>
          </div>

          {/* Métricas de contenido (Apify) — solo views/likes/comments reales.
              No se muestra reach/impressions/saves/shares porque no existen.
              Engagement siempre etiquetado como calculado. */}
          {hasMetrics && (
            <div className="section">
              <div className="section-title">Métricas de Contenido</div>
              <div className="info-grid">
                <div className="info-card">
                  <div className="info-label">Visualizaciones totales</div>
                  <div className="info-value">{formatFollowers(totalViews)}</div>
                </div>
                <div className="info-card">
                  <div className="info-label">Likes totales</div>
                  <div className="info-value">{formatFollowers(totalLikes)}</div>
                </div>
                <div className="info-card">
                  <div className="info-label">Comentarios totales</div>
                  <div className="info-value">{formatFollowers(totalComments)}</div>
                </div>
                <div className="info-card">
                  <div className="info-label">Interacciones totales</div>
                  <div className="info-value">{formatFollowers(totalInteractions)}</div>
                </div>
                <div className="info-card">
                  <div className="info-label">Engagement promedio (calculado)</div>
                  <div className="info-value" style={{ color: '#7c3aed' }}>
                    {avgEngagementRate !== null ? `${avgEngagementRate}%` : '—'}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                Basado en {deliverablesWithMetrics.length} de {deliverables.length} deliverables con métricas sincronizadas.
                Reach, impresiones, guardados y compartidos no están disponibles y no se muestran.
              </div>
            </div>
          )}

          {/* Por influencer — reemplaza las tablas separadas de influencers y deliverables */}
          {influencers.length > 0 && (
            <div className="section">
              <div className="section-title">Influencers ({influencers.length})</div>
              {influencers.map(ci => {
                const inf = ci.influencer
                if (!inf) return null

                const infDeliverables = deliverables.filter(d => d.influencer?.id === inf.id)
                const doneCount = infDeliverables.filter(d => d.status === 'published').length
                const pct = infDeliverables.length > 0 ? Math.round((doneCount / infDeliverables.length) * 100) : 0
                const uploadedDates = infDeliverables.map(d => d.published_at).filter(Boolean) as string[]
                const lastUploaded = uploadedDates.length > 0
                  ? uploadedDates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
                  : null

                const primaryProfile = inf.influencer_social_profiles?.[0]
                const labeled = labelDeliverables(infDeliverables)

                return (
                  <div key={ci.id} className="inf-card">
                    <div className="inf-card-header">
                      <div>
                        <div className="inf-name">{inf.display_name}</div>
                        <div className="inf-meta">
                          {primaryProfile
                            ? `${primaryProfile.platform}${primaryProfile.username ? ` · @${primaryProfile.username}` : ''}${primaryProfile.followers ? ` · ${formatFollowers(primaryProfile.followers)} seguidores` : ''}`
                            : 'Sin red social registrada'}
                        </div>
                      </div>
                      <span className="inf-pct">{pct}% completado</span>
                    </div>
                    <div className="inf-body">
                      <div className="inf-uploaded">
                        Fecha de contenido subido: {lastUploaded ? fmtDate(lastUploaded) : 'Pendiente'}
                      </div>
                      {labeled.length === 0 ? (
                        <div className="deliverable-row"><span className="deliverable-pending">Sin deliverables asignados</span></div>
                      ) : (
                        labeled.map(({ label, deliverable: d }) => {
                          const url = d.content_url || d.published_url
                          const perf = d.performance
                          return (
                            <div key={d.id} className="deliverable-row">
                              <span className="deliverable-label">{label}:</span>
                              {url ? (
                                <a href={url} target="_blank" rel="noopener noreferrer" className="deliverable-link">{url}</a>
                              ) : (
                                <span className="deliverable-pending">Pendiente</span>
                              )}
                              {perf && (
                                <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                                  ({perf.views != null ? `${formatFollowers(perf.views)} vistas · ` : ''}
                                  {formatFollowers(perf.likes ?? 0)} likes · {formatFollowers(perf.comments ?? 0)} comentarios
                                  {d.engagement_rate != null ? ` · ${d.engagement_rate}% eng. calc.` : ''})
                                </span>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="footer">
          <div className="footer-logo">SCENCE</div>
          <div className="footer-text">Reporte generado el {today} · {campaign.name}</div>
          <div className="footer-text">Confidencial</div>
        </div>
      </div>

      {/* Script for print button */}
      <script dangerouslySetInnerHTML={{ __html: `
        document.querySelector('.print-btn')?.addEventListener('click', function() {
          window.print();
        });
      ` }} />
    </>
  )
}

export const dynamic = 'force-dynamic'
