import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { detectLocale, LOCALE_COOKIE } from '@/i18n/config'
import { decidePortalRedirect, needsBrandMembershipCheck } from '@/lib/portal-navigation'

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

  // Banderas de metadata: solo orientan la NAVEGACIÓN entre portales, nunca
  // autorizan. Una misma identidad puede ser influencer y miembro de una marca
  // (ver src/lib/portal-navigation.ts); las páginas y APIs verifican en servidor.
  const flags = {
    isInfluencer: claims.user_metadata?.is_influencer === true,
    isBrand: claims.user_metadata?.is_brand === true,
  }

  // Solo si una cuenta con is_influencer (sin is_brand) abre el portal de marca:
  // se comprueba su membresía activa real (su propia fila, con su sesión).
  // Cualquier error o ausencia equivale a "sin membresía" (comportamiento histórico).
  let hasBrandMembership = false
  if (needsBrandMembershipCheck(flags, path)) {
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', claims.sub)
      .eq('is_active', true)
      .in('role', ['brand_manager', 'finance', 'member'])
      .limit(1)
      .maybeSingle()
    hasBrandMembership = Boolean(membership)
  }

  const redirectTo = decidePortalRedirect(flags, path, hasBrandMembership)
  if (redirectTo) return withLocale(NextResponse.redirect(new URL(redirectTo, request.url)))

  return withLocale(supabaseResponse)
}

export const config = {
  // Las APIs verifican su propia sesión y autorización. Excluirlas evita una
  // segunda verificación de Auth por cada carga de datos de la pantalla.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
