import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

type Params = { params: { key: string } }
type VersionPayload = { definition?: string; businessRules?: string[]; acceptanceCriteria?: string[]; changeReason?: string; impactSummary?: string; action?: 'propose' | 'approve' }

async function requirePlatformAdmin() {
  const session = createServerClient()
  const { data: { user }, error } = await session.auth.getUser()
  if (error || !user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  if (!(await isPlatformAdmin(user.id, admin))) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { admin, user }
}

export async function GET(_: NextRequest, { params }: Params) {
  const auth = await requirePlatformAdmin()
  if ('response' in auth) return auth.response
  const { data: requirement, error } = await auth.admin.from('requirements')
    .select('id, requirement_key, portal, module, functionality, title, implementation_status, approved_version_id, updated_at')
    .eq('requirement_key', params.key).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo leer el requerimiento.' }, { status: 500 })
  if (!requirement) return NextResponse.json({ error: 'Requerimiento no encontrado.' }, { status: 404 })
  const { data: versions, error: versionsError } = await auth.admin.from('requirement_versions')
    .select('id, version_number, lifecycle_status, definition, business_rules, acceptance_criteria, change_reason, impact_summary, created_at, approved_at')
    .eq('requirement_id', requirement.id).order('version_number', { ascending: false })
  if (versionsError) return NextResponse.json({ error: 'No se pudo leer el historial.' }, { status: 500 })
  const ids = (versions ?? []).map(version => version.id)
  const { data: evidence } = ids.length ? await auth.admin.from('requirement_evidence')
    .select('id, requirement_version_id, evidence_type, reference, details, verification_status, created_at')
    .in('requirement_version_id', ids).order('created_at', { ascending: false }) : { data: [] }
  return NextResponse.json({ requirement, versions: versions ?? [], evidence: evidence ?? [] })
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformAdmin()
  if ('response' in auth) return auth.response
  const body = await request.json() as VersionPayload
  const { data: requirement } = await auth.admin.from('requirements').select('id, approved_version_id').eq('requirement_key', params.key).maybeSingle()
  if (!requirement) return NextResponse.json({ error: 'Requerimiento no encontrado.' }, { status: 404 })
  if (body.action === 'approve') {
    const versionId = new URL(request.url).searchParams.get('versionId')
    if (!versionId) return NextResponse.json({ error: 'versionId es requerido.' }, { status: 422 })
    const { data: version } = await auth.admin.from('requirement_versions').select('id, lifecycle_status').eq('id', versionId).eq('requirement_id', requirement.id).maybeSingle()
    if (!version || version.lifecycle_status !== 'proposed') return NextResponse.json({ error: 'Solo se puede aprobar una versión propuesta del requerimiento.' }, { status: 409 })
    const now = new Date().toISOString()
    const approved = await auth.admin.from('requirement_versions').update({ lifecycle_status: 'approved', approved_by: auth.user.id, approved_at: now }).eq('id', versionId)
    if (approved.error) return NextResponse.json({ error: 'No se pudo aprobar la versión.' }, { status: 500 })
    await auth.admin.from('requirement_versions').update({ lifecycle_status: 'superseded' }).eq('requirement_id', requirement.id).eq('lifecycle_status', 'approved').neq('id', versionId)
    const updated = await auth.admin.from('requirements').update({ approved_version_id: versionId, implementation_status: 'por_verificar', updated_at: now }).eq('id', requirement.id)
    if (updated.error) return NextResponse.json({ error: 'No se pudo actualizar la definición aprobada.' }, { status: 500 })
    await auth.admin.from('audit_logs').insert({ actor_id: auth.user.id, action: 'requirement.version_approved', entity_type: 'requirement', entity_id: requirement.id, changes: { requirement_key: params.key, version_id: versionId } })
    return NextResponse.json({ ok: true })
  }
  if (!body.definition?.trim() || !body.changeReason?.trim()) return NextResponse.json({ error: 'La definición y el motivo del cambio son obligatorios.' }, { status: 422 })
  const { data: latest } = await auth.admin.from('requirement_versions').select('version_number').eq('requirement_id', requirement.id).order('version_number', { ascending: false }).limit(1).maybeSingle()
  const created = await auth.admin.from('requirement_versions').insert({
    requirement_id: requirement.id, version_number: (latest?.version_number ?? 0) + 1, definition: body.definition.trim(),
    business_rules: body.businessRules ?? [], acceptance_criteria: body.acceptanceCriteria ?? [], change_reason: body.changeReason.trim(),
    impact_summary: body.impactSummary?.trim() ?? '', created_by: auth.user.id,
  }).select('id, version_number').single()
  if (created.error) return NextResponse.json({ error: 'No se pudo registrar la propuesta.' }, { status: 500 })
  await auth.admin.from('audit_logs').insert({ actor_id: auth.user.id, action: 'requirement.version_proposed', entity_type: 'requirement', entity_id: requirement.id, changes: { requirement_key: params.key, version_id: created.data.id, version_number: created.data.version_number } })
  return NextResponse.json({ version: created.data }, { status: 201 })
}
