import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/presence/heartbeat
// Actualiza profiles.last_seen_at = now() para el usuario autenticado.
// Antes NADA en el código escribía esta columna — "Live influencers" en el
// dashboard admin siempre mostraba 0 porque no había ningún mecanismo que
// mantuviera ese timestamp al día (además del bug de nombre de campo
// corregido en DashboardClient.tsx). Se llama periódicamente desde
// <PresenceHeartbeat /> mientras la influencer tiene el portal abierto.
export async function POST() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) {
    console.error('[POST /api/presence/heartbeat]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
