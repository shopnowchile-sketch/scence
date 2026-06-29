import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

// ── GET /api/support — tickets del usuario autenticado (sin requerir org) ─────
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tickets')
    .select('id, title, description, status, priority, category, ai_review, created_at')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

// ── POST /api/support — crear ticket (funciona para marca e influencer) ────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, string>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { title, description, category = 'other', priority = 'P2' } = body

  if (!title?.trim())       return NextResponse.json({ error: 'El título es requerido' },     { status: 422 })
  if (!description?.trim()) return NextResponse.json({ error: 'La descripción es requerida' }, { status: 422 })

  const admin = createAdminClient()

  // Intentar obtener org_id — para influencers, buscar en influencers table como fallback
  let organizationId = await getOrgId(user.id, user.user_metadata, admin)

  if (!organizationId && user.user_metadata?.is_influencer === true) {
    const { data: infRow } = await admin
      .from('influencers')
      .select('organization_id')
      .eq('user_id', user.id)
      .single()
    organizationId = (infRow?.organization_id as string | null) ?? null
  }

  if (!organizationId && user.user_metadata?.is_brand === true) {
    const { data: brandRow } = await admin
      .from('brands')
      .select('organization_id')
      .eq('user_id', user.id)
      .single()
    organizationId = (brandRow?.organization_id as string | null) ?? null
  }

  const { data: ticket, error: insertError } = await admin
    .from('tickets')
    .insert({
      title:           title.trim(),
      description:     description.trim(),
      status:          'open',
      priority,
      category,
      created_by:      user.id,
      organization_id: organizationId,
      ai_review:       null,
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // IA en background (no bloqueante)
  void analyzeWithClaude(ticket.id, title.trim(), description.trim(), admin)

  return NextResponse.json({ data: ticket }, { status: 201 })
}

// ── Claude AI review (fire-and-forget) ────────────────────────────────────────
async function analyzeWithClaude(ticketId: string, title: string, description: string, admin: ReturnType<typeof createAdminClient>) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: 'You are a QA engineer for SCENCE, a SaaS platform for influencer campaign management. Analyze the support request and respond ONLY with valid JSON.',
        messages: [{ role: 'user', content: `Analyze this support request:\nTitle: ${title}\nDescription: ${description}\n\nRespond ONLY with JSON:\n{"severity":"high|medium|low","category":"ui|api|billing|auth|data|other","summary":"one-line summary","suggested_steps":["step1","step2"],"estimated_priority":"P1|P2|P3"}` }],
      }),
    })
    if (!res.ok) return
    const d = await res.json()
    const text = d.content?.[0]?.text ?? ''
    const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const review = JSON.parse(clean)
    await admin.from('tickets').update({ ai_review: review }).eq('id', ticketId)
  } catch { /* silent fail */ }
}
