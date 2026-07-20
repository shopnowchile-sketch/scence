import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

type Params = { params: { code: string } }

// ── GET /track/[code] — public redirect ───────────────────────────────────────
// No auth required. Increments click counter and redirects to redirect_url.
export async function GET(_req: NextRequest, { params }: Params) {
  const { code } = params
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '/'

  const admin = createAdminClient()

  // Look up the affiliate link
  const { data: link, error } = await admin
    .from('affiliate_links')
    .select('id, redirect_url')
    .eq('code', code)
    .maybeSingle()

  if (error || !link) {
    // Code not found — redirect to homepage
    return NextResponse.redirect(appUrl, { status: 302 })
  }

  // Incremento atómico: evita perder clics cuando llegan varias visitas juntas.
  const { error: incrementError } = await admin.rpc('increment_affiliate_link_clicks', {
    p_link_id: link.id,
  })
  if (incrementError) {
    console.error('[track/[code]] click increment failed:', incrementError.message)
  }

  return NextResponse.redirect(link.redirect_url, { status: 302 })
}
