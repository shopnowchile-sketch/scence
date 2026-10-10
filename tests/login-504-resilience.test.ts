// Incidente Login 504 (2026-10-06): pausa entre lotes de avisos masivos y
// middleware que distingue "sin sesión" de "Supabase no responde".
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/auth-js'
import {
  AUTH_DEADLINE_MS,
  AuthDeadlineError,
  BATCH_PAUSE_MS,
  MAX_TOTAL_BATCH_PAUSE_MS,
  batchPauseMs,
  isTemporaryAuthFailure,
  withDeadline,
} from '../src/lib/load-protection.ts'

// ── Pausa entre lotes ──────────────────────────────────────────────────────

test('sin pausa con un solo lote', () => {
  assert.equal(batchPauseMs(0), 0)
  assert.equal(batchPauseMs(1), 0)
})

test('roster chico: 5 s exactos entre lotes', () => {
  assert.equal(batchPauseMs(10), BATCH_PAUSE_MS)
  assert.equal(batchPauseMs(25), BATCH_PAUSE_MS)
})

test('roster actual (2.692 → 27 lotes): ~4,6 s entre lotes y ~2 min en total, dentro del tope', () => {
  const batches = Math.ceil(2692 / 100)
  assert.equal(batchPauseMs(batches), 4_615)
  assert.ok(batchPauseMs(batches) * (batches - 1) <= MAX_TOTAL_BATCH_PAUSE_MS)
})

test('el total de pausas nunca supera el tope, aunque el roster crezca', () => {
  for (let batches = 1; batches <= 2000; batches++) {
    const total = batchPauseMs(batches) * Math.max(0, batches - 1)
    assert.ok(total <= MAX_TOTAL_BATCH_PAUSE_MS, `batches=${batches} total=${total}`)
  }
  // 120 s de pausas + ~90 s de envío real quedan bajo maxDuration = 300 s.
  assert.ok(MAX_TOTAL_BATCH_PAUSE_MS + 90_000 < 300_000)
})

test('ambos envíos masivos pausan entre lotes reales, sin tocar el registro de idempotencia', () => {
  const source = readFileSync(new URL('../src/lib/campaign-notifications.ts', import.meta.url), 'utf8')
  const pauses = source.match(/if \(validChunk\.length === 0\) continue\n\s+if \(batchesSent\+\+ > 0 && pauseMs > 0\) await sleep\(pauseMs\)/g) ?? []
  assert.equal(pauses.length, 2, 'announceCampaignToInfluencers y announceCampaignReopened')
  assert.match(source, /\.upsert\(\s*validChunk\.map\(inf => \(\{ campaign_id: campaignId, influencer_id: inf\.id \}\)\),\s*\{ onConflict: 'campaign_id,influencer_id' \}/)
  assert.match(source, /if \(markErr\) \{[\s\S]*?skipped: 'mark_error'/)
})

// ── Clasificación de errores de Auth (con las clases reales de auth-js) ────

test('temporal: red, timeout, 5xx, 429 y plazo vencido', () => {
  assert.equal(isTemporaryAuthFailure(new AuthRetryableFetchError('fetch failed', 0)), true)
  assert.equal(isTemporaryAuthFailure(new AuthRetryableFetchError('gateway', 504)), true)
  assert.equal(isTemporaryAuthFailure(new AuthRetryableFetchError('bad gateway', 502)), true)
  assert.equal(isTemporaryAuthFailure(new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit')), true)
  assert.equal(isTemporaryAuthFailure(new AuthApiError('error finding refresh token: context canceled', 500, 'unexpected_failure')), true)
  assert.equal(isTemporaryAuthFailure(new AuthApiError('unavailable', 503, undefined)), true)
  assert.equal(isTemporaryAuthFailure(new AuthDeadlineError(AUTH_DEADLINE_MS)), true)
})

test('NO temporal (va a /login como hoy): sin error, sin sesión, refresh token inválido o usado, 4xx', () => {
  assert.equal(isTemporaryAuthFailure(null), false)
  assert.equal(isTemporaryAuthFailure(undefined), false)
  assert.equal(isTemporaryAuthFailure(new AuthSessionMissingError()), false)
  assert.equal(isTemporaryAuthFailure(new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found')), false)
  assert.equal(isTemporaryAuthFailure(new AuthApiError('Invalid Refresh Token: Already Used', 400, 'refresh_token_already_used')), false)
  assert.equal(isTemporaryAuthFailure(new AuthApiError('invalid JWT', 401, 'bad_jwt')), false)
  assert.equal(isTemporaryAuthFailure(new AuthApiError('forbidden', 403, undefined)), false)
  assert.equal(isTemporaryAuthFailure('504'), false)
})

test('withDeadline: devuelve el resultado si llega a tiempo', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 50), 'ok')
})

test('withDeadline: corta con AuthDeadlineError si Auth no responde', async () => {
  const never = new Promise(() => {})
  await assert.rejects(withDeadline(never, 20), (error: unknown) => error instanceof AuthDeadlineError)
})

test('el plazo de Auth queda bajo el corte de 25 s del middleware de Vercel', () => {
  assert.ok(AUTH_DEADLINE_MS < 25_000)
})

// ── Middleware: orden de las decisiones ────────────────────────────────────

test('middleware: el 503 va antes del redirect a /login, con respuesta nueva y sin conceder acceso', () => {
  const source = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8')
  assert.match(source, /withDeadline\(supabase\.auth\.getClaims\(\), AUTH_DEADLINE_MS\)/)
  const temporary = source.indexOf('if (!claims && isTemporaryAuthFailure(claimsError))')
  const login = source.indexOf("url.pathname = '/login'")
  const roles = source.indexOf('if (claims) {')
  assert.ok(temporary > 0 && temporary < login && login < roles, 'orden: temporal → login → reglas por rol')
  const branch = source.slice(temporary, source.indexOf('\n  }\n', temporary))
  assert.match(branch, /return withLocale\(highDemandResponse\(isApiRoute, locale\)\)/)
  assert.doesNotMatch(branch, /supabaseResponse/, 'no reutiliza supabaseResponse (que podría traer cookies borradas)')
  const fn = source.slice(source.indexOf('function highDemandResponse'))
  assert.match(fn, /status: 503/)
  assert.match(fn, /'Retry-After'/)
  assert.match(fn, /'Cache-Control': 'no-store'/)
})
