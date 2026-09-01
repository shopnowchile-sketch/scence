import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

const TODO_FIELDS = 'id, user_id, title, completed, created_at'
const MAX_TITLE_LENGTH = 200

export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('user_todos')
    .select(TODO_FIELDS)
    .order('completed', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/todos]', error)
    return NextResponse.json({ error: 'No se pudieron cargar tus tareas.' }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
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

  const rawTitle = typeof body === 'object' && body !== null && 'title' in body
    ? body.title
    : undefined
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''

  if (!title || title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: 'La tarea debe tener entre 1 y 200 caracteres.' }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('user_todos')
    .insert({ user_id: user.id, title })
    .select(TODO_FIELDS)
    .single()

  if (error) {
    console.error('[POST /api/todos]', error)
    return NextResponse.json({ error: 'No se pudo agregar la tarea.' }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
