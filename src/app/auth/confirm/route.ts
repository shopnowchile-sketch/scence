import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import type { EmailOtpType } from '@supabase/supabase-js'

// ── GET /auth/confirm ────────────────────────────────────────────────────────
// Verificación de links de recuperación/invitación basada en token_hash.
//
// A diferencia de /auth/callback (exchangeCodeForSession con PKCE), este
// método no depende de que el link se abra en el mismo navegador/dispositivo
// donde se solicitó. El code_verifier de PKCE se guarda en el navegador que
// hace el request original; si el correo se abre en otra app/navegador
// (Gmail, Instagram, otro celular), ese verifier no existe y Supabase
// responde "PKCE code verifier not found" → la persona queda sin poder
// entrar. verifyOtp con token_hash valida directo contra Supabase sin ese
// requisito.
//
// /auth/callback se mantiene intacto para no romper links ya enviados antes
// de este cambio (siguen usando el flujo con `code`).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  if (token_hash && type) {
    const supabase = createServerClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth/confirm] verifyOtp error:', error)

    // Para recuperación de contraseña, /reset-password ya sabe mostrar
    // "enlace inválido o expirado" cuando no hay sesión — dejamos que esa
    // pantalla maneje el error en vez de mandar a /login.
    if (next.startsWith('/reset-password')) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_confirm_failed`)
}
