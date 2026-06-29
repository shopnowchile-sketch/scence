import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

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
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const status   = searchParams.get('status')
  const priority = searchParams.get('priority')

  let query = admin
    .from('tickets')
    .select('id, title, description, status, priority, category, ai_review, created_by, created_at', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (status)   query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/tickets]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const tickets = data ?? []

  // ── Enriquecer con info del remitente ──────────────────────────────────────
  const userIds = Array.from(new Set(tickets.map(t => t.created_by).filter(Boolean))) as string[]

  const submitterMap: Record<string, { name: string; email: string; type: 'influencer' | 'brand' | 'admin' }> = {}

  if (userIds.length > 0) {
    // Influencers
    const { data: infs } = await admin
      .from('influencers')
      .select('user_id, display_name, email')
      .in('user_id', userIds)
    for (const inf of infs ?? []) {
      if (inf.user_id) submitterMap[inf.user_id] = {
        name:  inf.display_name ?? inf.email ?? 'Influencer',
        email: inf.email ?? '',
        type:  'influencer',
      }
    }

    // Brands
    const { data: brnds } = await admin
      .from('brands')
      .select('user_id, contact_name, contact_email, name')
      .in('user_id', userIds)
    for (const b of brnds ?? []) {
      if (b.user_id && !submitterMap[b.user_id]) submitterMap[b.user_id] = {
        name:  b.contact_name ?? b.name ?? 'Marca',
        email: b.contact_email ?? '',
        type:  'brand',
      }
    }

    // Admins — fallback via profiles + auth
    const remaining = userIds.filter(id => !submitterMap[id])
    for (const uid of remaining) {
      const { data: u } = await admin.auth.admin.getUserById(uid)
      if (u?.user) {
        submitterMap[uid] = {
          name:  u.user.user_metadata?.full_name ?? u.user.email ?? 'Admin',
          email: u.user.email ?? '',
          type:  'admin',
        }
      }
    }
  }

  const enriched = tickets.map(t => ({
    ...t,
    submitter: t.created_by ? (submitterMap[t.created_by] ?? null) : null,
  }))

  return NextResponse.json({ data: enriched, total: count ?? 0 })
}

// ── POST /api/tickets ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
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
