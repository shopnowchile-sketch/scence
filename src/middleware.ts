import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { detectLocale, LOCALE_COOKIE } from '@/i18n/config'

const PUBLIC_ROUTES = [
  '/login', '/register', '/forgot-password', '/reset-password',
  '/auth/callback',
  '/auth/confirm',            // verificación token_hash (recuperación/invitación) — sin sesión aún
  '/api/auth/forgot-password', // genera el link de recuperación — llamado sin sesión
  '/api/auth/register-brand',  // autorregistro de marca — llamado sin sesión
  '/terms', '/privacy',
  '/api/stripe/webhook',   // Stripe webhook — no auth needed (verified by signature)
  '/api/webhooks/resend',  // Resend webhook — no auth needed (verified by Svix signature)
  '/api/crm-leads/bulk-send/process', // job interno server-to-server — verificado con INTERNAL_JOB_SECRET, no lleva cookies de usuario
]

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_ROUTES.some(route => path.startsWith(route))
  const existingLocale = request.cookies.get(LOCALE_COOKIE)?.value
  const locale = detectLocale({
    cookieLocale: existingLocale,
    acceptLanguage: request.headers.get('accept-language'),
    country: request.headers.get('x-vercel-ip-country'),
  })

  if (!existingLocale) request.cookies.set(LOCALE_COOKIE, locale)

  const withLocale = (response: NextResponse) => {
    if (!existingLocale) {
      response.cookies.set(LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      })
    }
    return response
  }

  // Las páginas y webhooks públicos no necesitan renovar ni verificar una sesión.
  // Evitar esta llamada es importante cuando una campaña genera muchas visitas
  // simultáneas desde un correo o enlace compartido.
  if (isPublic) {
    return withLocale(NextResponse.next({ request }))
  }

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

  // getUser() hace una petición a Auth en cada navegación. getClaims() verifica
  // el JWT firmado (con JWKS cacheado) y evita que el middleware se convierta en
  // un cuello de botella durante aperturas masivas de campañas.
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  const isApiRoute = path.startsWith('/api/')

  if (!claims) {
    // API routes → return JSON 401 instead of HTML redirect
    if (isApiRoute) {
      return withLocale(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    // Pages → redirect to login with return param
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', path)
    return withLocale(NextResponse.redirect(url))
  }

  // Determinar rol del usuario autenticado
  const isInfluencer = claims.user_metadata?.is_influencer === true
  const isBrand      = claims.user_metadata?.is_brand === true

  // Rutas exclusivas de admin (inaccesibles para influencers y marcas)
  const ADMIN_ONLY = [
    '/admin-campaigns', '/admin-influencers', '/admin-analytics', '/admin-settings',
    '/admin-billing', '/admin-bookings', '/admin-brands', '/admin-payroll',
    '/admin-affiliates', '/admin-contracts', '/admin-events', '/admin-support',
    '/admin-dash', '/admin-crm',
  ]

  // Rutas exclusivas del portal influencer
  const INFLUENCER_ONLY = [
    '/inf-dash', '/inf-deliverables', '/inf-profile', '/inf-campaign', '/inf-campaigns',
    '/inf-bookings', '/inf-support', '/inf-brands',
    // legacy — keep for redirect safety
    '/dashboard', '/tasks', '/profile', '/my-campaigns', '/my-bookings',
  ]

  // Rutas exclusivas del portal de marcas
  const BRAND_ONLY = [
    '/brand-dash', '/brand-campaigns', '/brand-influencers', '/brand-support', '/brand-profile',
    // legacy
    '/brand',
  ]

  if (claims) {
    if (isBrand) {
      // Marca → solo puede acceder al portal de marcas
      if (path === '/login' || path === '/' || path === '/brand/dashboard') {
        return withLocale(NextResponse.redirect(new URL('/brand-dash', request.url)))
      }
      if (ADMIN_ONLY.some(r => path.startsWith(r)) || INFLUENCER_ONLY.some(r => path.startsWith(r))) {
        return withLocale(NextResponse.redirect(new URL('/brand-dash', request.url)))
      }
    } else if (isInfluencer) {
      if (path === '/login' || path === '/' || path === '/dashboard') {
        return withLocale(NextResponse.redirect(new URL('/inf-dash', request.url)))
      }
      // /influencers/support es accesible para influencers aunque /influencers esté en ADMIN_ONLY
      if (ADMIN_ONLY.some(r => path.startsWith(r)) && path !== '/influencers/support') {
        return withLocale(NextResponse.redirect(new URL('/inf-dash', request.url)))
      }
      if (BRAND_ONLY.some(r => path.startsWith(r))) {
        return withLocale(NextResponse.redirect(new URL('/inf-dash', request.url)))
      }
    } else {
      // Admin
      if (path === '/login' || path === '/') {
        return withLocale(NextResponse.redirect(new URL('/admin-dash', request.url)))
      }
      if (INFLUENCER_ONLY.some(r => path === r || path.startsWith(r + '/'))) {
        return withLocale(NextResponse.redirect(new URL('/admin-dash', request.url)))
      }
      if (BRAND_ONLY.some(r => path.startsWith(r))) {
        return withLocale(NextResponse.redirect(new URL('/admin-dash', request.url)))
      }
    }
  }

  return withLocale(supabaseResponse)
}

export const config = {
  // Las APIs verifican su propia sesión y autorización. Excluirlas evita una
  // segunda verificación de Auth por cada carga de datos de la pantalla.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
