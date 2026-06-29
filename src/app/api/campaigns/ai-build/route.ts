import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'

// ── Types ─────────────────────────────────────────────────────────────────────
interface AIBuildInput {
  company_name: string
  what_they_sell: string
  target_audience: string
  location: string
  main_objective: string
  budget: string
  social_platforms: string[]
  extra_info?: string
}

interface AIGeneratedCampaign {
  campaign_name: string
  description: string
  objective: string
  campaign_type: string
  target_audience_description: string
  suggested_influencer_count: number
  recommended_niches: string[]
  recommended_formats: string[]
  suggested_budget: number
  duration_days: number
  recommended_kpis: string[]
  brief: string
  hashtags: string[]
}

// ── Prompt ────────────────────────────────────────────────────────────────────
function buildPrompt(input: AIBuildInput): string {
  return `Eres un experto en marketing de influencers con 10 años de experiencia diseñando campañas para marcas en Latinoamérica y España. Tu tarea es analizar la información de una marca y generar los parámetros completos de una campaña de influencer marketing.

INFORMACIÓN DE LA MARCA:
- Empresa: ${input.company_name}
- Qué vende: ${input.what_they_sell}
- Público objetivo: ${input.target_audience}
- Ubicación/mercado: ${input.location}
- Objetivo principal: ${input.main_objective}
- Presupuesto aproximado: ${input.budget}
- Redes sociales: ${input.social_platforms.join(', ')}
${input.extra_info ? `- Información adicional: ${input.extra_info}` : ''}

INSTRUCCIONES:
Genera una campaña de influencer marketing estratégica y ejecutable. El nombre de la campaña debe ser creativo, memorable y reflejar la marca y el objetivo. El brief debe ser detallado y accionable para que los influencers sepan exactamente qué crear.

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta (sin markdown, sin explicaciones, solo JSON):

{
  "campaign_name": "nombre creativo de la campaña",
  "description": "descripción ejecutiva de 2-3 oraciones explicando la campaña y su estrategia",
  "objective": "awareness|consideration|conversion|loyalty|engagement",
  "campaign_type": "influencer|ugc|ambassador|product_launch|event|giveaway",
  "target_audience_description": "descripción detallada del público objetivo con datos demográficos y psicográficos",
  "suggested_influencer_count": número entero entre 3 y 50,
  "recommended_niches": ["nicho1", "nicho2", "nicho3"],
  "recommended_formats": ["formato1", "formato2", "formato3"],
  "suggested_budget": número en USD,
  "duration_days": número de días de campaña entre 14 y 90,
  "recommended_kpis": ["KPI1", "KPI2", "KPI3", "KPI4"],
  "brief": "brief completo de 3-5 párrafos con: contexto de la marca, mensaje clave, qué debe incluir el contenido, qué debe evitar, tono y estilo, call to action esperado",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"]
}`
}

// ── Claude API call (raw fetch — no SDK needed) ───────────────────────────────
async function callClaude(prompt: string): Promise<AIGeneratedCampaign> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':         'application/json',
      'x-api-key':            apiKey,
      'anthropic-version':    '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens:  1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Claude API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text ?? ''

  // Parse JSON — strip any accidental markdown fences
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed: AIGeneratedCampaign
  try {
    parsed = JSON.parse(clean)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${clean.slice(0, 200)}`)
  }

  return parsed
}

// ── Map AI output → campaigns table columns ───────────────────────────────────
function mapToCampaign(ai: AIGeneratedCampaign, orgId: string | null, userId: string) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() + 7) // starts in 1 week
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + ai.duration_days)

  return {
    name:               ai.campaign_name,
    description:        ai.description,
    type:               ai.campaign_type,
    status:             'draft',
    start_date:         startDate.toISOString().split('T')[0],
    end_date:           endDate.toISOString().split('T')[0],
    budget_total:       ai.suggested_budget,
    budget_spent:       0,
    currency:           'CLP',
    // goals JSONB: store structured AI output
    goals: {
      objective:               ai.objective,
      kpis:                    ai.recommended_kpis,
      suggested_influencers:   ai.suggested_influencer_count,
      recommended_niches:      ai.recommended_niches,
      recommended_formats:     ai.recommended_formats,
      target_audience:         ai.target_audience_description,
      ai_generated:            true,
    },
    hashtags:           ai.hashtags,
    platforms:          [],            // user fills in edit view
    content_guidelines: ai.brief,      // brief → content guidelines
    approval_required:  true,
    tags:               ai.recommended_niches.slice(0, 5),
    brief_url:          null,
    organization_id:    orgId,
    created_by:         userId,
  }
}

// ── POST /api/campaigns/ai-build ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: AIBuildInput
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Validate required fields
  const required: (keyof AIBuildInput)[] = ['company_name', 'what_they_sell', 'target_audience', 'location', 'main_objective', 'budget']
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json({ error: `${field} is required` }, { status: 422 })
    }
  }

  // Call Claude
  let aiResult: AIGeneratedCampaign
  try {
    const prompt = buildPrompt(body)
    aiResult = await callClaude(prompt)
  } catch (e: unknown) {
    console.error('[ai-build] Claude error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI generation failed' },
      { status: 502 }
    )
  }

  // Create campaign in DB (same schema as manual creation)
  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const campaignData = mapToCampaign(aiResult, orgId, user.id)

  const { data: campaign, error: dbError } = await admin
    .from('campaigns')
    .insert(campaignData)
    .select()
    .single()

  if (dbError) {
    console.error('[ai-build] DB insert error:', dbError)
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({
    data:       campaign,
    ai_output:  aiResult,   // returned for display in edit view
  }, { status: 201 })
}
