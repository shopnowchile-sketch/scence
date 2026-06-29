import { NextRequest, NextResponse } from 'next/server'

type Params = { params: { code: string } }

// ── DEPRECATED: Use /api/track/[code] instead ─────────────────────────────────
// This route is kept only to avoid 404s from old links.
// The canonical implementation lives in /api/track/[code]/route.ts
export async function GET(_req: NextRequest, { params }: Params) {
  const { code } = params
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return NextResponse.redirect(`${appUrl}/api/track/${code}`, { status: 301 })
}
