import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const TODO_FIELDS = 'id, user_id, title, completed, created_at'
type Params = { params: { id: string } }

export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const completed = typeof body === 'object' && body !== null && 'completed' in body
    ? body.completed
    : undefined

  if (typeof completed !== 'boolean') {
    return NextResponse.json({ error: 'completed debe ser booleano.' }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('user_todos')
    .update({ completed })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select(TODO_FIELDS)
    .maybeSingle()

  if (error) {
    console.error('[PATCH /api/todos/[id]]', error)
    return NextResponse.json({ error: 'No se pudo actualizar la tarea.' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Tarea no encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ data })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('user_todos')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[DELETE /api/todos/[id]]', error)
    return NextResponse.json({ error: 'No se pudo eliminar la tarea.' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Tarea no encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ deleted: true })
}
