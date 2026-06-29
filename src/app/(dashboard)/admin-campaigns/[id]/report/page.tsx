import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'

// ── Types ────────────────────────────────────────────────────────────────────
interface Brand {
  id: string
  name: string
  logo_url: string | null
  website: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
}

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
  brand: Brand | null
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

const DEL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  in_review: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  published: 'Publicado',
}

const DEL_STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',
  in_review: '#d97706',
  approved: '#2563eb',
  rejected: '#dc2626',
  published: '#059669',
}

function formatFollowers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
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
      brand:brands (id, name, logo_url, website, email, phone, contact_name),
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
          table { page-break-inside: avoid; }
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

        /* Info grid */
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
        .info-card { background: #fafafa; border: 1px solid #f0f0f0; border-radius: 10px; padding: 14px 16px; }
        .info-label { font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .info-value { font-size: 15px; font-weight: 700; color: #1a1a2e; }

        /* Brand box */
        .brand-box { display: flex; align-items: center; gap: 16px; background: #f9f7ff; border: 1px solid #ede9fe; border-radius: 10px; padding: 16px 20px; }
        .brand-logo { width: 52px; height: 52px; border-radius: 8px; object-fit: contain; background: white; border: 1px solid #e5e7eb; }
        .brand-initials { width: 52px; height: 52px; border-radius: 8px; background: #7c3aed; color: white; font-size: 20px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .brand-name { font-size: 17px; font-weight: 700; color: #1a1a2e; }
        .brand-contact { font-size: 12px; color: #6b7280; margin-top: 2px; }

        /* Progress bar */
        .progress-summary { display: flex; align-items: center; gap: 20px; background: #f9f7ff; border: 1px solid #ede9fe; border-radius: 10px; padding: 16px 20px; }
        .progress-number { font-size: 36px; font-weight: 800; color: #7c3aed; line-height: 1; }
        .progress-label { font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
        .progress-bar-wrap { flex: 1; }
        .progress-bar-track { height: 10px; background: #ede9fe; border-radius: 6px; overflow: hidden; margin-bottom: 6px; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #a78bfa); border-radius: 6px; transition: width 0.3s; }
        .progress-stats { font-size: 12px; color: #6b7280; }

        /* Influencer table */
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        thead th { background: #7c3aed; color: white; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        thead th:first-child { border-radius: 8px 0 0 0; }
        thead th:last-child { border-radius: 0 8px 0 0; }
        tbody tr { border-bottom: 1px solid #f3f4f6; }
        tbody tr:last-child { border-bottom: none; }
        tbody tr:hover { background: #faf9ff; }
        tbody td { padding: 11px 14px; vertical-align: middle; color: #374151; }
        .influencer-name { font-weight: 600; color: #1a1a2e; }
        .influencer-meta { font-size: 11px; color: #9ca3af; margin-top: 2px; }
        .status-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .fee-value { font-weight: 700; color: #7c3aed; }

        /* Deliverable table */
        .del-row-published td { background: #f0fdf4; }
        .del-row-rejected td { background: #fff7f7; }

        /* Footer */
        .footer { background: #1a1a2e; color: white; padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; }
        .footer-logo { font-size: 14px; font-weight: 800; letter-spacing: -0.3px; }
        .footer-text { font-size: 11px; opacity: 0.5; }

        /* Print button */
        .print-btn { position: fixed; bottom: 24px; right: 24px; background: #7c3aed; color: white; border: none; border-radius: 12px; padding: 12px 24px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 20px rgba(124,58,237,0.4); z-index: 100; display: flex; align-items: center; gap-8px; gap: 8px; }
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

          {/* Campaign Info */}
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
              <div className="info-card">
                <div className="info-label">Presupuesto total</div>
                <div className="info-value" style={{ color: '#7c3aed' }}>
                  {campaign.budget_total != null ? fmtCurrency(campaign.budget_total, campaign.currency) : '—'}
                </div>
              </div>
              <div className="info-card">
                <div className="info-label">Presupuesto ejecutado</div>
                <div className="info-value">{fmtCurrency(campaign.budget_spent ?? 0, campaign.currency)}</div>
              </div>
              <div className="info-card">
                <div className="info-label">Influencers</div>
                <div className="info-value">{influencers.length}</div>
              </div>
              <div className="info-card">
                <div className="info-label">Deliverables</div>
                <div className="info-value">{deliverables.length}</div>
              </div>
            </div>
            {campaign.description && (
              <div style={{ marginTop: 14, padding: '12px 16px', background: '#f9fafb', borderRadius: 8, fontSize: 13, color: '#4b5563', lineHeight: 1.6, borderLeft: '3px solid #ede9fe' }}>
                {campaign.description}
              </div>
            )}
          </div>

          {/* Brand */}
          {campaign.brand && (
            <div className="section">
              <div className="section-title">Marca</div>
              <div className="brand-box">
                {campaign.brand.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={campaign.brand.logo_url} alt={campaign.brand.name} className="brand-logo" />
                ) : (
                  <div className="brand-initials">
                    {campaign.brand.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="brand-name">{campaign.brand.name}</div>
                  <div className="brand-contact">
                    {[campaign.brand.contact_name, campaign.brand.contact_email, campaign.brand.contact_phone]
                      .filter(Boolean).join(' · ')}
                  </div>
                  {campaign.brand.website && (
                    <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 2 }}>{campaign.brand.website}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Progress Summary */}
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
                  {deliverables.filter(d => d.status === 'in_review').length > 0 && (
                    <> · {deliverables.filter(d => d.status === 'in_review').length} en revisión</>
                  )}
                  {deliverables.filter(d => d.status === 'pending').length > 0 && (
                    <> · {deliverables.filter(d => d.status === 'pending').length} pendientes</>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Influencers */}
          {influencers.length > 0 && (
            <div className="section">
              <div className="section-title">Influencers Asignados ({influencers.length})</div>
              <table>
                <thead>
                  <tr>
                    <th>Influencer</th>
                    <th>Ubicación</th>
                    <th>Red Social</th>
                    <th>Seguidores</th>
                    <th>Fee</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {influencers.map(ci => {
                    const inf = ci.influencer
                    if (!inf) return null
                    const primaryProfile = inf.influencer_social_profiles?.[0]
                    return (
                      <tr key={ci.id}>
                        <td>
                          <div className="influencer-name">{inf.display_name}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {[inf.city, inf.country].filter(Boolean).join(', ') || '—'}
                          </div>
                        </td>
                        <td>
                          {primaryProfile ? (
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'capitalize' }}>
                                {primaryProfile.platform}
                              </div>
                              {primaryProfile.username && (
                                <div style={{ fontSize: 11, color: '#9ca3af' }}>@{primaryProfile.username}</div>
                              )}
                            </div>
                          ) : '—'}
                        </td>
                        <td>
                          {primaryProfile ? (
                            <span style={{ fontWeight: 600, color: '#1a1a2e' }}>
                              {formatFollowers(primaryProfile.followers)}
                              {primaryProfile.engagement_rate != null && (
                                <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 11, marginLeft: 4 }}>
                                  ({primaryProfile.engagement_rate.toFixed(1)}% ER)
                                </span>
                              )}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <span className="fee-value">
                            {ci.fee != null ? fmtCurrency(ci.fee, campaign.currency) : '—'}
                          </span>
                        </td>
                        <td>
                          <span className="status-pill" style={{
                            background: ci.status === 'confirmed' ? '#ecfdf5' : ci.status === 'canceled' ? '#fef2f2' : '#f3f4f6',
                            color: ci.status === 'confirmed' ? '#065f46' : ci.status === 'canceled' ? '#991b1b' : '#374151',
                          }}>
                            {ci.status ?? 'propuesto'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Deliverables */}
          {deliverables.length > 0 && (
            <div className="section">
              <div className="section-title">Deliverables ({deliverables.length})</div>
              <table>
                <thead>
                  <tr>
                    <th>Título</th>
                    <th>Influencer</th>
                    <th>Tipo</th>
                    <th>Entrega</th>
                    <th>Estado</th>
                    <th>Contenido</th>
                  </tr>
                </thead>
                <tbody>
                  {deliverables.map(d => (
                    <tr key={d.id} className={d.status === 'published' ? 'del-row-published' : d.status === 'rejected' ? 'del-row-rejected' : ''}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#1a1a2e', fontSize: 13 }}>{d.title}</div>
                        {d.review_notes && (
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>💬 {d.review_notes}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: '#374151' }}>
                        {d.influencer?.display_name ?? '—'}
                      </td>
                      <td>
                        {d.type ? (
                          <span style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 8px', borderRadius: 10, color: '#374151', fontWeight: 500 }}>
                            {d.type.replace(/_/g, ' ')}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: '#6b7280' }}>
                        {fmtDate(d.due_date)}
                      </td>
                      <td>
                        <span className="status-pill" style={{
                          background: DEL_STATUS_COLORS[d.status] + '18',
                          color: DEL_STATUS_COLORS[d.status],
                        }}>
                          {DEL_STATUS_LABELS[d.status] ?? d.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {(d.published_url || d.content_url) ? (
                          <a href={d.published_url || d.content_url!} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#7c3aed', fontWeight: 600, textDecoration: 'none' }}>
                            Ver publicación ↗
                          </a>
                        ) : d.published_at ? (
                          <span style={{ color: '#059669' }}>Pub. {fmtDate(d.published_at)}</span>
                        ) : (
                          <span style={{ color: '#d1d5db' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Hashtags */}
          {campaign.hashtags?.length > 0 && (
            <div className="section">
              <div className="section-title">Hashtags</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {campaign.hashtags.map(h => (
                  <span key={h} style={{ background: '#f3f0ff', color: '#7c3aed', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                    #{h.replace(/^#/, '')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Content guidelines */}
          {campaign.content_guidelines && (
            <div className="section">
              <div className="section-title">Lineamientos de Contenido</div>
              <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.7, background: '#f9fafb', border: '1px solid #f0f0f0', borderRadius: 8, padding: '14px 16px' }}>
                {campaign.content_guidelines}
              </div>
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
