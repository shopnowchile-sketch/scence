import { NextRequest, NextResponse } from 'next/server'
import { authorizeCollaborationAdmin, loadCollaboratorImportPlan } from '@/lib/campaign-collaborations'

type Params = { params: { id: string } }

// POST /api/campaigns/[id]/collaborations/import
// Trae a la ficha las marcas colaboradoras que ya existen en la campaña (campaign_brands).
// Idempotente: lo que ya está en la ficha no se toca (estado, notas, plan quedan como están) y
// la restricción única (campaña+marca / campaña+lead) impide duplicados aun con dos ejecuciones
// simultáneas. Las marcas que no se pueden resolver con certeza NO se importan y se informan.
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await authorizeCollaborationAdmin(params.id)
  if (!auth.ok) return auth.response
  const { admin, userId } = auth

  let plan
  try { plan = await loadCollaboratorImportPlan(admin, params.id) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo preparar la importación' }, { status: 500 }) }

  const imported: string[] = []
  const skipped = [...plan.alreadyPresent]
  for (const item of plan.toInsert) {
    const { error } = await admin.from('campaign_brand_collaborations')
      .insert({ campaign_id: params.id, brand_id: item.brand_id, lead_id: item.lead_id, created_by: userId })
    if (!error) { imported.push(item.name); continue }
    if (error.code === '23505') { skipped.push(item.name); continue }   // otra ejecución ya la creó
    return NextResponse.json({ error: error.message, imported, skipped }, { status: 500 })
  }
  return NextResponse.json({ imported, skipped, needs_review: plan.needsReview, ambiguous_leads: plan.ambiguousLeads })
}
