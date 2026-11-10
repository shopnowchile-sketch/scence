import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireSupportAdmin } from '@/lib/support-admin'

const NAME_MAX = 120
const BODY_MAX = 5000

function clean(body: { name?: unknown; body?: unknown }) {
  const name = String(body.name ?? '').trim()
  const text = String(body.body ?? '').trim()
  if (!name || name.length > NAME_MAX) return { error: 'Ingresa un nombre válido.' } as const
  if (!text || text.length > BODY_MAX) return { error: 'Ingresa un mensaje válido.' } as const
  return { name, text } as const
}

export async function GET() {
  const auth = await requireSupportAdmin()
  if ('error' in auth) return auth.error
  const { data, error } = await auth.admin.from('support_reply_templates').select('key, name, body').order('updated_at', { ascending: true })
  if (error) return NextResponse.json({ error: 'No se pudieron cargar las plantillas.' }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireSupportAdmin()
  if ('error' in auth) return auth.error
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }) }
  const v = clean(body)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 422 })
  const key = `t_${randomUUID().slice(0, 8)}`
  const { data, error } = await auth.admin.from('support_reply_templates').insert({ key, name: v.name, body: v.text }).select('key, name, body').single()
  if (error) return NextResponse.json({ error: 'No se pudo crear la plantilla.' }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const auth = await requireSupportAdmin()
  if ('error' in auth) return auth.error
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }) }
  const v = clean(body)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 422 })
  if (!body.key) return NextResponse.json({ error: 'Falta la plantilla.' }, { status: 422 })
  const { data, error } = await auth.admin.from('support_reply_templates').update({ name: v.name, body: v.text, updated_at: new Date().toISOString() }).eq('key', String(body.key)).select('key')
  if (error) return NextResponse.json({ error: 'No se pudo guardar la plantilla.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSupportAdmin()
  if ('error' in auth) return auth.error
  const key = new URL(request.url).searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'Falta la plantilla.' }, { status: 422 })
  const { error } = await auth.admin.from('support_reply_templates').delete().eq('key', key)
  if (error) return NextResponse.json({ error: 'No se pudo eliminar la plantilla.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
