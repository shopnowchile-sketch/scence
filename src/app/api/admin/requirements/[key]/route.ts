import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/supabase/ensureOrg'

type Params = { params: { key: string } }
type VersionPayload = {
  definition?: unknown
  businessRules?: unknown
  acceptanceCriteria?: unknown
  changeReason?: unknown
  impactSummary?: unknown
  versionId?: unknown
  evidenceType?: unknown
  reference?: unknown
  details?: unknown
  verificationStatus?: unknown
  action?: unknown
}

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
  if (error) {
    console.error('[requirements GET] requirement lookup failed', error)
    return NextResponse.json({ error: 'No se pudo leer el requerimiento.' }, { status: 500 })
  }
  if (!requirement) return NextResponse.json({ error: 'Requerimiento no encontrado.' }, { status: 404 })

  const { data: versions, error: versionsError } = await auth.admin.from('requirement_versions')
    .select('id, version_number, lifecycle_status, definition, business_rules, acceptance_criteria, change_reason, impact_summary, created_at, approved_at')
    .eq('requirement_id', requirement.id).order('version_number', { ascending: false })
  if (versionsError) {
    console.error('[requirements GET] versions lookup failed', versionsError)
    return NextResponse.json({ error: 'No se pudo leer el historial.' }, { status: 500 })
  }

  const ids = (versions ?? []).map(version => version.id)
  let evidence: unknown[] = []
  if (ids.length) {
    const result = await auth.admin.from('requirement_evidence')
      .select('id, requirement_version_id, evidence_type, reference, details, verification_status, created_at')
      .in('requirement_version_id', ids).order('created_at', { ascending: false })
    if (result.error) {
      console.error('[requirements GET] evidence lookup failed', result.error)
      return NextResponse.json({ error: 'No se pudo leer la evidencia.' }, { status: 500 })
    }
    evidence = result.data ?? []
  }
  return NextResponse.json({ requirement, versions: versions ?? [], evidence })
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformAdmin()
  if ('response' in auth) return auth.response

  const parsed = await request.json().catch(() => null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'El cuerpo JSON no es válido.' }, { status: 400 })
  }
  const body = parsed as VersionPayload

  if (body.action === 'add_evidence') {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (typeof body.versionId !== 'string' || !uuidPattern.test(body.versionId)) {
      return NextResponse.json({ error: 'versionId debe ser un UUID válido.' }, { status: 422 })
    }
    const evidenceTypes = ['code', 'document', 'test', 'impact', 'deviation', 'validation']
    if (typeof body.evidenceType !== 'string' || !evidenceTypes.includes(body.evidenceType)) {
      return NextResponse.json({ error: 'Tipo de evidencia no válido.' }, { status: 422 })
    }
    if (typeof body.reference !== 'string' || !body.reference.trim() || body.reference.trim().length > 1000) {
      return NextResponse.json({ error: 'La referencia es obligatoria y debe tener como máximo 1.000 caracteres.' }, { status: 422 })
    }
    if (body.details !== undefined && (typeof body.details !== 'string' || body.details.length > 3000)) {
      return NextResponse.json({ error: 'El detalle debe tener como máximo 3.000 caracteres.' }, { status: 422 })
    }
    const verificationStatus = body.verificationStatus ?? 'pending'
    if (typeof verificationStatus !== 'string' || !['pending', 'passed', 'failed'].includes(verificationStatus)) {
      return NextResponse.json({ error: 'Estado de verificación no válido.' }, { status: 422 })
    }
    const { data, error } = await auth.admin.rpc('add_requirement_evidence', {
      p_requirement_key: params.key,
      p_version_id: body.versionId,
      p_evidence_type: body.evidenceType,
      p_reference: body.reference.trim(),
      p_details: typeof body.details === 'string' ? body.details.trim() : '',
      p_verification_status: verificationStatus,
      p_created_by: auth.user.id,
    })
    if (error) {
      console.error('[requirements POST] evidence write failed', error)
      if (error.code === 'P0002') return NextResponse.json({ error: 'Requerimiento o versión no encontrados.' }, { status: 404 })
      if (error.code === '23505') return NextResponse.json({ error: 'Esta evidencia ya está registrada para la versión.' }, { status: 409 })
      return NextResponse.json({ error: 'No se pudo registrar la evidencia.' }, { status: 500 })
    }
    return NextResponse.json({ evidence: data }, { status: 201 })
  }

  if (body.action === 'approve') {
    const versionId = new URL(request.url).searchParams.get('versionId')
    if (!versionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(versionId)) {
      return NextResponse.json({ error: 'versionId debe ser un UUID válido.' }, { status: 422 })
    }
    const { data, error } = await auth.admin.rpc('approve_requirement_version', {
      p_requirement_key: params.key,
      p_version_id: versionId,
      p_approved_by: auth.user.id,
    })
    if (error) {
      console.error('[requirements POST] atomic approval failed', error)
      if (error.code === 'P0002') return NextResponse.json({ error: 'Requerimiento no encontrado.' }, { status: 404 })
      if (error.code === 'P0001') return NextResponse.json({ error: 'La versión ya no está propuesta o no pertenece al requerimiento.' }, { status: 409 })
      return NextResponse.json({ error: 'No se pudo aprobar la versión; no se confirmaron cambios parciales.' }, { status: 500 })
    }
    return NextResponse.json(data ?? { ok: true })
  }

  if (body.action !== undefined && body.action !== 'propose') {
    return NextResponse.json({ error: 'Acción no válida.' }, { status: 422 })
  }
  if (typeof body.definition !== 'string' || !body.definition.trim() || body.definition.trim().length > 10000) {
    return NextResponse.json({ error: 'La definición es obligatoria y debe tener como máximo 10.000 caracteres.' }, { status: 422 })
  }
  if (typeof body.changeReason !== 'string' || !body.changeReason.trim() || body.changeReason.trim().length > 2000) {
    return NextResponse.json({ error: 'El motivo es obligatorio y debe tener como máximo 2.000 caracteres.' }, { status: 422 })
  }
  const isStringArray = (value: unknown): value is string[] =>
    value === undefined || (Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === 'string' && item.length <= 2000))
  if (!isStringArray(body.businessRules) || !isStringArray(body.acceptanceCriteria)) {
    return NextResponse.json({ error: 'Reglas y criterios deben ser listas de texto (máximo 100 elementos de 2.000 caracteres).' }, { status: 422 })
  }
  if (body.impactSummary !== undefined && (typeof body.impactSummary !== 'string' || body.impactSummary.length > 5000)) {
    return NextResponse.json({ error: 'El resumen de impacto debe tener como máximo 5.000 caracteres.' }, { status: 422 })
  }

  const { data, error } = await auth.admin.rpc('propose_requirement_version', {
    p_requirement_key: params.key,
    p_definition: body.definition.trim(),
    p_business_rules: body.businessRules ?? [],
    p_acceptance_criteria: body.acceptanceCriteria ?? [],
    p_change_reason: body.changeReason.trim(),
    p_impact_summary: typeof body.impactSummary === 'string' ? body.impactSummary.trim() : '',
    p_created_by: auth.user.id,
  })
  if (error) {
    console.error('[requirements POST] atomic proposal failed', error)
    if (error.code === 'P0002') return NextResponse.json({ error: 'Requerimiento no encontrado.' }, { status: 404 })
    return NextResponse.json({ error: 'No se pudo registrar la propuesta.' }, { status: 500 })
  }
  return NextResponse.json({ version: data }, { status: 201 })
}
