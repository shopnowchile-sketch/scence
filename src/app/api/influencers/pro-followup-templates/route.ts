import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/pro-followup-admin'
import { SUBJECT_MAX, BODY_MAX } from '@/lib/pro-followup'

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { data, error } = await auth.admin.from('influencer_email_templates').select('key, kind, name, subject, body, updated_at').order('kind').order('key')
  if (error) return NextResponse.json({ error: 'No se pudieron cargar las plantillas.' }, { status: 500 })
  return NextResponse.json({ templates: data ?? [] })
}

// Edita asunto, mensaje y nombre. El tipo (kind) no se cambia: define las reglas de envío.
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  let body: { key?: string; name?: string; subject?: string; body?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }) }
  const subject = String(body.subject ?? '').trim()
  const text = String(body.body ?? '').trim()
  const name = String(body.name ?? '').trim()
  if (!body.key) return NextResponse.json({ error: 'Falta la plantilla.' }, { status: 422 })
  if (!subject || subject.length > SUBJECT_MAX) return NextResponse.json({ error: 'Asunto inválido.' }, { status: 422 })
  if (!text || text.length > BODY_MAX) return NextResponse.json({ error: 'Mensaje inválido.' }, { status: 422 })
  const patch: Record<string, unknown> = { subject, body: text, updated_by: auth.userId, updated_at: new Date().toISOString() }
  if (name) patch.name = name.slice(0, 120)
  const { data, error } = await auth.admin.from('influencer_email_templates').update(patch).eq('key', body.key).select('key')
  if (error) return NextResponse.json({ error: 'No se pudo guardar la plantilla.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
