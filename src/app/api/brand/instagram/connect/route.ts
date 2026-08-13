import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getMetaInstagramConfig, META_INSTAGRAM_CALLBACK_URL, signInstagramState } from '@/lib/meta-instagram'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'))

  const access = await resolveBrandAccess(user.id)
  if (!access || !hasBrandPermission(access, 'brand.manage')) {
    return NextResponse.redirect(new URL('/brand-settings/organization?instagram=forbidden', process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'))
  }

  const config = getMetaInstagramConfig()
  if (!config) {
    return NextResponse.redirect(new URL('/brand-settings/organization?instagram=unavailable', process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'))
  }

  const payload = JSON.stringify({ brandId: access.brandId, nonce: crypto.randomUUID(), expiresAt: Date.now() + 10 * 60 * 1000 })
  const state = `${Buffer.from(payload).toString('base64url')}.${signInstagramState(payload, config.stateSecret)}`
  const authorize = new URL('https://www.instagram.com/oauth/authorize')
  authorize.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: META_INSTAGRAM_CALLBACK_URL,
    response_type: 'code',
    scope: 'instagram_business_basic',
    state,
  }).toString()

  const response = NextResponse.redirect(authorize)
  response.cookies.set('scence_ig_oauth', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/api/brand/instagram',
  })
  return response
}
