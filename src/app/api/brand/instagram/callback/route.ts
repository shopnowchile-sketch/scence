import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getMetaInstagramConfig, isValidInstagramState, META_INSTAGRAM_CALLBACK_URL, normalizeInstagramHandle } from '@/lib/meta-instagram'

export const dynamic = 'force-dynamic'

type InstagramProfile = { user_id?: string; username?: string; name?: string; profile_picture_url?: string }

function redirect(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/brand-settings/organization?instagram=${status}`, request.url))
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get('error')
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const storedState = request.cookies.get('scence_ig_oauth')?.value
  const config = getMetaInstagramConfig()
  if (error || !code || !state || !storedState || state !== storedState || !config) return redirect(request, error ? 'cancelled' : 'error')

  const [encodedPayload, signature] = state.split('.')
  if (!encodedPayload || !signature) return redirect(request, 'error')

  let payload: { brandId?: string; expiresAt?: number }
  try { payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) } catch { return redirect(request, 'error') }
  const rawPayload = JSON.stringify(payload)
  if (!payload.brandId || !payload.expiresAt || payload.expiresAt < Date.now() || !isValidInstagramState(rawPayload, signature, config.stateSecret)) return redirect(request, 'error')

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect(request, 'forbidden')
  const access = await resolveBrandAccess(user.id)
  if (!access || access.brandId !== payload.brandId || !hasBrandPermission(access, 'brand.manage')) return redirect(request, 'forbidden')

  try {
    const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: META_INSTAGRAM_CALLBACK_URL,
        code,
      }),
      cache: 'no-store',
    })
    const tokenData = await tokenResponse.json() as { access_token?: string }
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error('token_exchange_failed')

    const profileResponse = await fetch(`https://graph.instagram.com/me?fields=user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(tokenData.access_token)}`, { cache: 'no-store' })
    const profile = await profileResponse.json() as InstagramProfile
    const username = profile.username ? normalizeInstagramHandle(profile.username) : ''
    if (!profileResponse.ok || !username) throw new Error('profile_fetch_failed')

    const admin = createAdminClient()
    const { data: brand, error: brandError } = await admin.from('brands').select('name, instagram').eq('id', access.brandId).single()
    if (brandError || !brand) throw new Error('brand_not_found')
    const logoUrl = profile.profile_picture_url?.startsWith('https://') ? profile.profile_picture_url : null
    const update: Record<string, string | null> = { instagram: username, updated_at: new Date().toISOString() }
    if (logoUrl) update.logo_url = logoUrl
    if (!brand.name?.trim() && profile.name?.trim()) update.name = profile.name.trim()
    const { error: updateError } = await admin.from('brands').update(update).eq('id', access.brandId)
    if (updateError) throw updateError
  } catch (err) {
    console.error('[Instagram OAuth callback]', err)
    const response = redirect(request, 'error')
    response.cookies.delete('scence_ig_oauth')
    return response
  }

  const response = redirect(request, 'connected')
  response.cookies.delete('scence_ig_oauth')
  return response
}
