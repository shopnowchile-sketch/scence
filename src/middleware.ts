import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { detectLocale, LOCALE_COOKIE } from '@/i18n/config'
import {
  AUTH_DEADLINE_MS,
  AuthDeadlineError,
  HIGH_DEMAND_RETRY_SECONDS,
  isTemporaryAuthFailure,
  withDeadline,
} from '@/lib/load-protection'

const PUBLIC_ROUTES = [
  '/login', '/register', '/forgot-password', '/reset-password',
  '/auth/callback',
  '/auth/confirm',            // verificación token_hash (recuperación/invitación) — sin sesión aún
  '/api/auth/forgot-password', // genera el link de recuperación — llamado sin sesión
  '/api/auth/register-brand',  // autorregistro de marca — llamado sin sesión
  '/terms', '/privacy',
  '/api/webhooks/resend',  // Resend webhook — no auth needed (verified by Svix signature)
  '/api/crm-leads/bulk-send/process', // job interno server-to-server — verificado con INTERNAL_JOB_SECRET, no lleva cookies de usuario
  '/api/unsubscribe',      // baja de emails comerciales — pública por diseño, autorizada por HMAC en el token
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
  //
  // Con un plazo total (AUTH_DEADLINE_MS): si Auth está saturado, la librería
  // reintenta el refresh hasta ~30 s y Vercel corta el middleware a los 25 s.
  let claimsResult: Awaited<ReturnType<typeof supabase.auth.getClaims>>
  try {
    claimsResult = await withDeadline(supabase.auth.getClaims(), AUTH_DEADLINE_MS)
  } catch (error) {
    if (!(error instanceof AuthDeadlineError)) throw error
    claimsResult = { data: null, error } as unknown as typeof claimsResult
  }
  const { data: claimsData, error: claimsError } = claimsResult
  const claims = claimsData?.claims
  const isApiRoute = path.startsWith('/api/')

  // Supabase caído o saturado (timeout, 429, 5xx) ≠ "sin sesión": no se da
  // acceso, pero tampoco se manda a /login. Se responde 503 con una respuesta
  // NUEVA (no supabaseResponse) para no propagar el borrado de cookies que la
  // librería hace ante 429/500: la sesión sigue intacta y el reintento entra.
  if (!claims && isTemporaryAuthFailure(claimsError)) {
    const failure = claimsError as { name?: string; status?: number } | null
    console.warn('[middleware] Auth no disponible, respondiendo 503:', path, failure?.name, failure?.status)
    return withLocale(highDemandResponse(isApiRoute, locale))
  }

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

/** 503 "alta demanda" con reintento automático. Nunca concede acceso. */
function highDemandResponse(isApiRoute: boolean, locale: string) {
  const headers = {
    'Retry-After': String(HIGH_DEMAND_RETRY_SECONDS),
    'Cache-Control': 'no-store',
  }
  const en = locale === 'en'
  const message = en
    ? 'High demand right now. Retrying automatically…'
    : 'Estamos con alta demanda. Reintentando automáticamente…'
  if (isApiRoute) {
    return NextResponse.json({ error: message, retryAfter: HIGH_DEMAND_RETRY_SECONDS }, { status: 503, headers })
  }
  const html = `<!doctype html><html lang="${en ? 'en' : 'es'}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta http-equiv="refresh" content="${HIGH_DEMAND_RETRY_SECONDS}">`
    + `<title>SCENCE</title></head>`
    + `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;color:#111827">`
    + `<div style="text-align:center;padding:24px;max-width:420px"><p style="font-weight:800;font-size:20px;margin:0 0 8px">SCENCE</p>`
    + `<p style="margin:0 0 16px;color:#4b5563">${message}</p>`
    + `<a href="" style="color:#7c3aed;font-weight:600">${en ? 'Retry now' : 'Reintentar ahora'}</a></div></body></html>`
  return new NextResponse(html, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
}

export const config = {
  // Las APIs verifican su propia sesión y autorización. Excluirlas evita una
  // segunda verificación de Auth por cada carga de datos de la pantalla.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
