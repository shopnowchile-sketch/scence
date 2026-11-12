import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, isPlatformAdmin, ADMIN_ROLES } from '@/lib/supabase/ensureOrg'
import { ACTIVE_STATUSES, proFollowupTicketIds } from '@/lib/support-tickets'
import { buildSubmitterMap, type TicketSubmitter } from '@/lib/ticket-submitters'

// ── Types ─────────────────────────────────────────────────────────────────────
interface AIReview {
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: 'ui' | 'api' | 'data' | 'auth' | 'billing' | 'performance' | 'other'
  summary: string
  suggested_steps: string[]
  estimated_priority: 'P0' | 'P1' | 'P2' | 'P3'
}

// ── Claude AI analysis ────────────────────────────────────────────────────────
async function analyzeTicketWithClaude(title: string, description: string): Promise<AIReview | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[tickets] ANTHROPIC_API_KEY not set — skipping AI review')
    return null
  }

  const userMessage = `Analyze this bug report and respond ONLY with a valid JSON object (no markdown, no explanation):

Title: ${title}
Description: ${description}

Required JSON structure:
{
  "severity": "critical|high|medium|low",
  "category": "ui|api|data|auth|billing|performance|other",
  "summary": "one-line summary of the bug",
  "suggested_steps": ["step 1 to reproduce or fix", "step 2", "step 3"],
  "estimated_priority": "P0|P1|P2|P3"
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system:     'You are a QA engineer reviewing bug reports for SCENCE, a SaaS platform for influencer campaign management. Analyze the bug and respond in JSON.',
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[tickets] Claude API error:', response.status, err)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text ?? ''
    const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()

    return JSON.parse(clean) as AIReview
  } catch (e) {
    console.error('[tickets] Failed to parse Claude response:', e)
    return null
  }
}

// ── GET /api/tickets ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // /api/tickets es el panel de ADMIN (SupportPage adminMode). Marcas e influencers crean/leen sus tickets por /api/support.
  if (!(await isPlatformAdmin(user.id, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const status   = searchParams.get('status')
  const priority = searchParams.get('priority')
  const page     = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const limit    = Math.min(100, Math.max(10, Number(searchParams.get('limit') ?? '50') || 50))

  if (searchParams.get('counts') === '1') {
    const countStatus = (ticketStatuses: readonly string[]) =>
      admin.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', [...ticketStatuses])
    const [open, inProgress, closed, pro] = await Promise.all([
      countStatus(['open']), countStatus(['in_progress']), countStatus(['closed']), proFollowupTicketIds(admin, orgId),
    ])
    // «Todos» = solo activos (Abiertos + En progreso); los cerrados son historial.
    return NextResponse.json({ counts: { all: (open.count ?? 0) + (inProgress.count ?? 0), open: open.count ?? 0, in_progress: inProgress.count ?? 0, closed: closed.count ?? 0, pro: pro.ids.length } })
  }

  let query = admin
    .from('tickets')
    .select('id, title, description, status, priority, category, ai_review, created_by, created_at')
    .eq('organization_id', orgId)

  if (status === 'pro') {
    const pro = await proFollowupTicketIds(admin, orgId)
    if (pro.error) return NextResponse.json({ error: pro.error }, { status: 500 })
    query = query.in('id', pro.ids.length ? pro.ids : ['00000000-0000-0000-0000-000000000000'])
  } else if (status === 'open' || status === 'in_progress' || status === 'closed') {
    query = query.eq('status', status)
  } else {
    query = query.in('status', [...ACTIVE_STATUSES])
  }
  if (priority) query = query.eq('priority', priority)

  // Activos: prioridad (P0 → P3) y luego el más antiguo primero. Cerrados (historial): el más reciente primero.
  query = status === 'closed'
    ? query.order('created_at', { ascending: false })
    : query.order('priority', { ascending: true }).order('created_at', { ascending: true })

  const from = (page - 1) * limit
  const { data, error } = await query.range(from, from + limit)

  if (error) {
    console.error('[GET /api/tickets]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const hasMore = (data?.length ?? 0) > limit
  const tickets = (data ?? []).slice(0, limit)

  // ── Enriquecer con info del remitente ──────────────────────────────────────
  const userIds = Array.from(new Set(tickets.map(t => t.created_by).filter(Boolean))) as string[]

  // Rol real del autor (src/lib/ticket-submitters.ts): «Admin» solo si es
  // super_admin activo; un autor sin ficha se muestra «Usuario sin perfil».
  let submitterMap: Record<string, TicketSubmitter> = {}

  if (userIds.length > 0) {
    const [{ data: infs }, { data: brnds }, { data: members }, { data: admins }, { data: profs }] = await Promise.all([
      admin.from('influencers').select('id, user_id, user_name, email').in('user_id', userIds),
      admin.from('brands').select('id, user_id, contact_name, contact_email, name').in('user_id', userIds),
      admin.from('brand_members').select('user_id, email, brand_id').in('user_id', userIds).eq('is_active', true),
      admin.from('organization_members').select('user_id').in('user_id', userIds).eq('is_active', true).in('role', ADMIN_ROLES),
      admin.from('profiles').select('user_id, user_name').in('user_id', userIds),
    ])

    const profileNames = new Map((profs ?? []).map(p => [p.user_id as string, (p.user_name as string | null) ?? null]))
    const accounts: Record<string, { name?: string | null; email?: string | null }> = {}
    // Email desde Auth solo para quienes no son influencer ni marca (pocos).
    const needsAuth = userIds.filter(id =>
      !(infs ?? []).some(i => i.user_id === id) && !(brnds ?? []).some(b => b.user_id === id))
    for (const uid of needsAuth) {
      const { data: u } = await admin.auth.admin.getUserById(uid)
      accounts[uid] = { name: profileNames.get(uid) ?? u?.user?.user_metadata?.full_name ?? null, email: u?.user?.email ?? null }
    }

    submitterMap = buildSubmitterMap({
      userIds,
      platformAdminIds: new Set((admins ?? []).map(a => a.user_id as string)),
      influencers: infs ?? [],
      brands: brnds ?? [],
      brandMembers: (members ?? []).map(m => ({
        user_id: m.user_id as string | null,
        brand_id: m.brand_id as string,
        email: (m.email as string | null) ?? null,
        name: accounts[m.user_id as string]?.name ?? null,
      })),
      accounts,
    })
  }

  const enriched = tickets.map(t => ({
    ...t,
    submitter: t.created_by ? (submitterMap[t.created_by] ?? null) : null,
  }))

  return NextResponse.json({ data: enriched, page, limit, has_more: hasMore })
}

// ── POST /api/tickets ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // /api/tickets es el panel de ADMIN (SupportPage adminMode). Marcas e influencers crean/leen sus tickets por /api/support.
  if (!(await isPlatformAdmin(user.id, admin))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { title, description, priority = 'P2', category = 'other' } = body as Record<string, string>

  if (!title || typeof title !== 'string' || title.trim() === '') {
    return NextResponse.json({ error: 'title is required' }, { status: 422 })
  }
  if (!description || typeof description !== 'string' || description.trim() === '') {
    return NextResponse.json({ error: 'description is required' }, { status: 422 })
  }

  // Insert ticket first
  const { data: ticket, error: insertError } = await admin
    .from('tickets')
    .insert({
      title:           title.trim(),
      description:     description.trim(),
      status:          'open',
      priority,
      category,
      organization_id: orgId,
      created_by:      user.id,
      ai_review:       null,
    })
    .select()
    .single()

  if (insertError) {
    console.error('[POST /api/tickets]', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Kick off Claude analysis and update the ticket
  const aiReview = await analyzeTicketWithClaude(title.trim(), description.trim())

  if (aiReview) {
    const { data: updated, error: updateError } = await admin
      .from('tickets')
      .update({ ai_review: aiReview })
      .eq('id', ticket.id)
      .select()
      .single()

    if (updateError) {
      console.error('[POST /api/tickets] ai_review update failed:', updateError)
      // Still return the ticket without ai_review rather than failing
      return NextResponse.json({ data: ticket }, { status: 201 })
    }

    return NextResponse.json({ data: updated }, { status: 201 })
  }

  return NextResponse.json({ data: ticket }, { status: 201 })
}
