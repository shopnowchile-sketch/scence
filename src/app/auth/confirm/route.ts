import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/safe-redirect'
import type { EmailOtpType } from '@supabase/supabase-js'

// ── /auth/confirm ────────────────────────────────────────────────────────────
// Verificación de links de confirmación/recuperación/invitación con token_hash.
//
// A diferencia de /auth/callback (PKCE), no depende de que el link se abra en el
// mismo navegador donde se solicitó.
//
// El token_hash es de UN solo uso. Antes, el simple GET lo consumía: los
// antivirus/escáneres de correo y las vistas previas de apps abren los enlaces
// antes que la persona y lo gastaban ("enlace vencido" al hacer clic).
// Ahora el GET solo muestra una pantalla con un botón; el token se consume con
// el POST de ese botón, que un escáner no ejecuta.
//
// /auth/callback se mantiene intacto para no romper links ya enviados.

const VALID_TYPES: readonly EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function parseType(value: string | null): EmailOtpType | null {
  return VALID_TYPES.includes(value as EmailOtpType) ? (value as EmailOtpType) : null
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function failureRedirect(origin: string, next: string) {
  // /reset-password ya sabe mostrar "enlace inválido o expirado" sin sesión.
  if (next.startsWith('/reset-password')) return NextResponse.redirect(`${origin}${next}`, 303)
  return NextResponse.redirect(`${origin}/login?error=auth_confirm_failed`, 303)
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = parseType(searchParams.get('type'))
  const next = safeInternalPath(searchParams.get('next'), '/')
  if (!tokenHash || !type) return NextResponse.redirect(`${origin}/login?error=auth_confirm_failed`)

  const isRecovery = type === 'recovery'
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>SCENCE</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:48px 16px">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)">
<div style="font-size:22px;font-weight:900;color:#7c3aed;margin-bottom:16px">SCENCE</div>
<h1 style="font-size:20px;color:#111827;margin:0 0 8px">${isRecovery ? 'Crea tu nueva contraseña' : 'Confirma tu cuenta'}</h1>
<p style="color:#6b7280;font-size:15px;line-height:1.5;margin:0 0 24px">Presiona el botón para continuar.</p>
<form method="POST" action="/auth/confirm">
<input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}">
<input type="hidden" name="type" value="${escapeHtml(type)}">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<button type="submit" style="background:#7c3aed;color:#fff;border:0;border-radius:12px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer">Continuar</button>
</form></div></body></html>`
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url)
  const form = await request.formData().catch(() => null)
  const tokenHash = form?.get('token_hash')
  const type = parseType(typeof form?.get('type') === 'string' ? (form?.get('type') as string) : null)
  const next = safeInternalPath(typeof form?.get('next') === 'string' ? (form?.get('next') as string) : null, '/')
  if (typeof tokenHash !== 'string' || !tokenHash || !type) return failureRedirect(origin, next)

  const supabase = createServerClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) {
    console.error('[auth/confirm] verifyOtp error:', error.message)
    return failureRedirect(origin, next)
  }
  return NextResponse.redirect(`${origin}${next}`, 303)
}
