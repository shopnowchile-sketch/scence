import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'

const PUBLIC_ROUTES = [
  '/login', '/register', '/forgot-password', '/reset-password',
  '/auth/callback',
  '/terms', '/privacy',
  '/api/stripe/webhook',   // Stripe webhook — no auth needed (verified by signature)
]

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_ROUTES.some(r => path.startsWith(r))
  const isApiRoute = path.startsWith('/api/')

  if (!user && !isPublic) {
    // API routes → return JSON 401 instead of HTML redirect
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Pages → redirect to login with return param
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', path)
    return NextResponse.redirect(url)
  }

  // Determinar rol del usuario autenticado
  const isInfluencer = user?.user_metadata?.is_influencer === true
  const isBrand      = user?.user_metadata?.is_brand === true

  // Rutas exclusivas de admin (inaccesibles para influencers y marcas)
  const ADMIN_ONLY = [
    '/admin-campaigns', '/admin-influencers', '/admin-analytics', '/admin-settings',
    '/admin-billing', '/admin-bookings', '/admin-brands', '/admin-payroll',
    '/admin-affiliates', '/admin-contracts', '/admin-events', '/admin-support',
    '/admin-dash',
  ]

  // Rutas exclusivas del portal influencer
  const INFLUENCER_ONLY = [
    '/inf-dash', '/inf-tasks', '/inf-profile', '/inf-campaign', '/inf-campaigns',
    '/inf-bookings', '/inf-support',
    // legacy — keep for redirect safety
    '/dashboard', '/tasks', '/profile', '/my-campaigns', '/my-bookings',
  ]

  // Rutas exclusivas del portal de marcas
  const BRAND_ONLY = [
    '/brand-dash', '/brand-campaigns', '/brand-influencers', '/brand-support', '/brand-profile',
    // legacy
    '/brand',
  ]

  if (user) {
    if (isBrand) {
      // Marca → solo puede acceder al portal de marcas
      if (path === '/login' || path === '/' || path === '/brand/dashboard') {
        return NextResponse.redirect(new URL('/brand-dash', request.url))
      }
      if (ADMIN_ONLY.some(r => path.startsWith(r)) || INFLUENCER_ONLY.some(r => path.startsWith(r))) {
        return NextResponse.redirect(new URL('/brand-dash', request.url))
      }
    } else if (isInfluencer) {
      if (path === '/login' || path === '/' || path === '/dashboard') {
        return NextResponse.redirect(new URL('/inf-dash', request.url))
      }
      // /influencers/support es accesible para influencers aunque /influencers esté en ADMIN_ONLY
      if (ADMIN_ONLY.some(r => path.startsWith(r)) && path !== '/influencers/support') {
        return NextResponse.redirect(new URL('/inf-dash', request.url))
      }
      if (BRAND_ONLY.some(r => path.startsWith(r))) {
        return NextResponse.redirect(new URL('/inf-dash', request.url))
      }
    } else {
      // Admin
      if (path === '/login' || path === '/') {
        return NextResponse.redirect(new URL('/admin-dash', request.url))
      }
      if (INFLUENCER_ONLY.some(r => path === r || path.startsWith(r + '/'))) {
        return NextResponse.redirect(new URL('/admin-dash', request.url))
      }
      if (BRAND_ONLY.some(r => path.startsWith(r))) {
        return NextResponse.redirect(new URL('/admin-dash', request.url))
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
