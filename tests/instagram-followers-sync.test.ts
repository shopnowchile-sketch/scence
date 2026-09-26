// Sincronización de followers de Instagram (auditoría 2026-09-25, doc 07).
//   node --test tests/instagram-followers-sync.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// followers-sync.ts importa módulos locales sin extensión (como los resuelve Next).
register('./support/ts-resolve.mjs', import.meta.url)
const BD = await import('../src/lib/instagram/business-discovery.ts')
const FS = await import('../src/lib/instagram/followers-sync.ts')
const SP = await import('../src/lib/instagram/social-profiles.ts')
const HINT = await import('../src/lib/instagram/sync-label.ts')
type SyncRow = import('../src/lib/instagram/followers-sync.ts').SyncRow
type SyncStore = import('../src/lib/instagram/followers-sync.ts').SyncStore
type DiscoveryResult = import('../src/lib/instagram/business-discovery.ts').DiscoveryResult

const NOW = new Date('2026-09-26T12:00:00Z')

// ── Store en memoria con la misma semántica de lock que Postgres ────────────
type MemRow = SyncRow & { sync_status: string; synced_at: string | null; sync_attempted_at: string | null; sync_locked_until: string | null }
function memStore(rows: MemRow[]) {
  const saves: Array<{ id: string; patch: Record<string, unknown> }> = []
  const store: SyncStore = {
    async claim({ profileIds, limit, lockUntil, now }) {
      const free = (r: MemRow) => !r.sync_locked_until || r.sync_locked_until < now
      const pool = profileIds
        ? rows.filter(r => profileIds.includes(r.id))
        : [...rows].filter(r => r.sync_attempted_at === null || r.sync_attempted_at < new Date(Date.parse(now) - FS.RETRY_OK_MS).toISOString())
          .sort((a, b) => (a.sync_attempted_at ?? '').localeCompare(b.sync_attempted_at ?? ''))
      const claimed: SyncRow[] = []
      for (const r of pool.slice(0, limit)) {
        if (!free(r)) continue
        r.sync_locked_until = lockUntil // atómico en JS, como el UPDATE condicional
        claimed.push({ id: r.id, influencer_id: r.influencer_id, username: r.username, profile_url: r.profile_url, followers: r.followers, raw_data: r.raw_data })
      }
      return claimed
    },
    async save(id, patch) {
      const r = rows.find(x => x.id === id)!
      Object.assign(r, patch)
      saves.push({ id, patch: patch as Record<string, unknown> })
      return { error: null }
    },
    async release(ids) { for (const r of rows) if (ids.includes(r.id)) r.sync_locked_until = null },
    async countDue(now) { return rows.filter(r => r.sync_attempted_at === null || r.sync_attempted_at < new Date(Date.parse(now) - FS.RETRY_OK_MS).toISOString()).length },
  }
  return { store, saves, rows }
}
function row(id: string, username: string | null, followers: number | null, extra: Partial<MemRow> = {}): MemRow {
  return { id, influencer_id: `inf-${id}`, username, profile_url: null, followers, raw_data: {}, sync_status: 'pending', synced_at: null, sync_attempted_at: null, sync_locked_until: null, ...extra }
}
const ok = (followers: number, extra: Partial<Extract<DiscoveryResult, { kind: 'ok' }>> = {}): DiscoveryResult => ({ kind: 'ok', followers, igUserId: '1784', username: null, usagePct: 10, ...extra })
const run = (store: SyncStore, discover: (h: string) => Promise<DiscoveryResult>, extra = {}) =>
  FS.syncInstagramFollowers(store, { token: 't', discover, now: () => NOW, ...extra })

describe('Business Discovery: cliente y clasificación', () => {
  const fakeFetch = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    async () => ({ ok: status < 400, status, headers: { get: (n: string) => headers[n] ?? null }, json: async () => body })

  test('1. Instagram devuelve followers correctamente', async () => {
    const r = await BD.fetchBusinessDiscovery('balmaqueroll', {
      token: 'x',
      fetchImpl: fakeFetch(200, { business_discovery: { username: 'balmaqueroll', followers_count: 50229, id: '17841402125366105' } }, { 'x-business-use-case-usage': '{"1784":[{"call_count":12,"total_time":3,"total_cputime":2}]}' }),
    })
    assert.deepEqual(r, { kind: 'ok', followers: 50229, igUserId: '17841402125366105', username: 'balmaqueroll', usagePct: 12 })
  })
  test('los logs nunca incluyen el token', async () => {
    const lines: string[] = []
    const orig = console.info
    console.info = (...args: unknown[]) => { lines.push(args.join(' ')) }
    try {
      const { store } = memStore([row('a', 'uno', 100)])
      await FS.syncInstagramFollowers(store, { token: 'SECRET-TOKEN', now: () => NOW, discover: async () => ok(120) })
    } finally { console.info = orig }
    assert.ok(lines.length > 0); assert.ok(lines.every(l => !l.includes('SECRET-TOKEN')))
  })
  test('cuenta personal o @ inexistente (110/2207013) → not_found', () => {
    assert.equal(BD.classifyGraphError(400, { code: 110, error_subcode: 2207013, message: 'Invalid user id' }).kind, 'not_found')
  })
  test('5/6/13. 401, 403 y token expirado (190) → auth_error', () => {
    assert.equal(BD.classifyGraphError(401, undefined).kind, 'auth_error')
    assert.equal(BD.classifyGraphError(403, undefined).kind, 'auth_error')
    assert.equal(BD.classifyGraphError(400, { code: 190, message: 'Error validating access token' }).kind, 'auth_error')
  })
  test('7. rate limit (429 / code 4, 17, 32, 613, 80002) → rate_limited', () => {
    assert.equal(BD.classifyGraphError(429, undefined).kind, 'rate_limited')
    for (const code of [4, 17, 32, 613, 80002]) assert.equal(BD.classifyGraphError(400, { code }).kind, 'rate_limited')
  })
  test('4. otro error de API → api_error', () => {
    assert.equal(BD.classifyGraphError(500, { code: 1, message: 'boom' }).kind, 'api_error')
  })
  test('9. followers inválido (null, negativo, decimal, string) → api_error', async () => {
    for (const bad of [null, -5, 1.5, '1000']) {
      const r = await BD.fetchBusinessDiscovery('a', { token: 'x', fetchImpl: fakeFetch(200, { business_discovery: { followers_count: bad } }) })
      assert.equal(r.kind, 'api_error', String(bad))
    }
  })
  test('handles: @, URL y basura', () => {
    assert.equal(BD.cleanInstagramHandle('@Pia.Nitou'), 'pia.nitou')
    assert.equal(BD.cleanInstagramHandle('https://www.instagram.com/javicj_/'), 'javicj_')
    assert.equal(BD.cleanInstagramHandle('instagram.com/correo@gmail.com'), null)
    assert.equal(BD.cleanInstagramHandle(''), null)
  })
})

describe('Regla de integridad (buildSyncPatch)', () => {
  const prev = (followers: number | null) => ({ followers, raw_data: {} })
  test('2/3. éxito guarda followers, synced_at y el id de IG', () => {
    const { patch } = BD.buildSyncPatch(prev(49854), ok(50229, { igUserId: '999' }), NOW)
    assert.equal(patch.followers, 50229); assert.equal(patch.synced_at, NOW.toISOString()); assert.equal(patch.sync_status, 'ok')
    assert.equal((patch.raw_data as Record<string, unknown>).ig_user_id, '999')
  })
  test('4. un error nunca toca followers ni synced_at', () => {
    const { patch } = BD.buildSyncPatch(prev(15230), { kind: 'api_error', message: 'boom' }, NOW)
    assert.equal('followers' in patch, false); assert.equal('synced_at' in patch, false)
    assert.equal(patch.sync_status, 'api_error'); assert.equal(patch.sync_attempted_at, NOW.toISOString())
  })
  test('10. followers = 0: válido si ya era 0; caída a 0 desde positivo se rechaza', () => {
    assert.equal(BD.buildSyncPatch(prev(0), ok(0), NOW).patch.followers, 0)
    const drop = BD.buildSyncPatch(prev(15230), ok(0), NOW)
    assert.equal('followers' in drop.patch, false); assert.equal(drop.patch.sync_error, 'zero_from_positive')
  })
  test('11/12. aumento y disminución se guardan; cambio > 50% se registra como anomalía sin bloquear', () => {
    assert.equal(BD.buildSyncPatch(prev(12500), ok(15230), NOW).anomaly, null)
    assert.equal(BD.buildSyncPatch(prev(15230), ok(14000), NOW).patch.followers, 14000)
    const big = BD.buildSyncPatch(prev(10000), ok(3000), NOW)
    assert.equal(big.patch.followers, 3000); assert.ok(big.anomaly)
  })
})

describe('syncInstagramFollowers (orquestación)', () => {
  test('16. dos influencers distintas se sincronizan cada una con su valor', async () => {
    const { store, rows } = memStore([row('a', 'uno', 100), row('b', 'dos', 200)])
    const r = await run(store, async h => ok(h === 'uno' ? 150 : 250))
    assert.equal(r.synced, 2); assert.equal(rows[0].followers, 150); assert.equal(rows[1].followers, 250)
    assert.ok(rows.every(x => x.sync_locked_until === null))
  })
  test('17. sin handle válido → no se llama a Instagram, queda no sincronizable', async () => {
    let calls = 0
    const { store, rows } = memStore([row('a', null, 0)])
    const r = await run(store, async () => { calls++; return ok(1) })
    assert.equal(calls, 0); assert.equal(r.not_found, 1); assert.equal(rows[0].sync_status, 'not_found')
  })
  test('5/7. auth_error o rate limit cortan el lote, no marcan el perfil y liberan locks', async () => {
    for (const kind of ['auth_error', 'rate_limited'] as const) {
      const { store, rows, saves } = memStore([row('a', 'uno', 100), row('b', 'dos', 200), row('c', 'tres', 300)])
      const r = await run(store, async h => h === 'uno' ? ok(110) : { kind, message: 'x' })
      assert.equal(r.stopped, kind); assert.equal(saves.length, 1)
      assert.equal(rows[1].followers, 200); assert.equal(rows[1].sync_status, 'pending')
      assert.ok(rows.every(x => x.sync_locked_until === null), 'locks liberados')
    }
  })
  test('8. sin token (Instagram no configurado) → no escribe nada', async () => {
    const { store, saves } = memStore([row('a', 'uno', 100)])
    await assert.rejects(FS.syncInstagramFollowers(store, { token: '', now: () => NOW }))
    assert.equal(saves.length, 0)
  })
  test('15. ejecución duplicada: dos corridas simultáneas no sincronizan el mismo perfil', async () => {
    const { store } = memStore([row('a', 'uno', 100), row('b', 'dos', 200)])
    let calls = 0
    const slow = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return ok(1) }
    const [r1, r2] = await Promise.all([run(store, slow), run(store, slow)])
    assert.equal(calls, 2); assert.equal(r1.attempted + r2.attempted, 2)
  })
  test('20/19. lote interrumpido por tiempo: libera lo no procesado y la siguiente corrida continúa', async () => {
    const { store, rows } = memStore([row('a', 'uno', 1), row('b', 'dos', 2), row('c', 'tres', 3)])
    let t = NOW.getTime()
    const clock = () => new Date(t)
    const r1 = await FS.syncInstagramFollowers(store, { token: 't', now: clock, deadlineMs: 1000, discover: async () => { t += 800; return ok(10) } })
    assert.equal(r1.stopped, 'deadline'); assert.equal(r1.synced, 2); assert.equal(r1.remaining, 1)
    assert.equal(rows[2].sync_locked_until, null)
    const r2 = await FS.syncInstagramFollowers(store, { token: 't', now: clock, discover: async () => ok(10) })
    assert.equal(r2.synced, 1); assert.equal(r2.remaining, 0)
  })
  test('el lote se detiene al acercarse al límite de uso de Meta', async () => {
    const { store } = memStore([row('a', 'uno', 1), row('b', 'dos', 2)])
    const r = await run(store, async () => ok(5, { usagePct: 85 }))
    assert.equal(r.stopped, 'usage_budget'); assert.equal(r.attempted, 1)
  })
})

describe('Formularios no pisan followers (social-profiles)', () => {
  const existing = [{ id: 'ig1', platform: 'instagram', username: 'pia' }, { id: 'tt1', platform: 'tiktok', username: 'pia' }]
  test('editar sin cambiar @ no toca followers de Instagram', () => {
    const plan = SP.planSocialProfileChanges('inf', existing, [{ id: 'ig1', platform: 'instagram', username: '@Pia', followers_count: 999 }, { platform: 'tiktok', username: 'pia', followers_count: 5000 }])
    const ig = plan.updates.find(u => u.id === 'ig1')!
    assert.equal('followers' in ig.values, false); assert.equal(plan.resyncExistingIds.length, 0)
    assert.equal(plan.updates.find(u => u.id === 'tt1')!.values.followers, 5000, 'otras redes siguen manuales')
  })
  test('14. cambio de @ → pending, conserva el último valor y pide re-sync', () => {
    const plan = SP.planSocialProfileChanges('inf', existing, [{ platform: 'instagram', username: 'pia_nueva' }, { platform: 'tiktok', username: 'pia' }])
    const ig = plan.updates.find(u => u.id === 'ig1')!
    assert.equal(ig.values.sync_status, 'pending'); assert.equal('followers' in ig.values, false)
    assert.deepEqual(plan.resyncExistingIds, ['ig1'])
  })
  test('ya no hay DELETE + INSERT: solo se borra la red que se quitó', () => {
    const plan = SP.planSocialProfileChanges('inf', existing, [{ platform: 'instagram', username: 'pia' }])
    assert.deepEqual(plan.deletes, ['tt1']); assert.equal(plan.inserts.length, 0)
  })
  test('Instagram nuevo: número tipeado solo como inicial y queda pending', () => {
    const plan = SP.planSocialProfileChanges('inf', [], [{ platform: 'instagram', username: 'x', followers_count: 1200 }])
    assert.equal(plan.inserts[0].sync_status, 'pending'); assert.equal(plan.inserts[0].followers, 1200); assert.ok(plan.insertsNeedSync)
  })
})

describe('18. UI: estado visible en vez de un número engañoso', () => {
  test('0 no confirmado se oculta; estados se describen', () => {
    const H = HINT
    assert.equal(H.hideUnconfirmedZero({ platform: 'instagram', followers: 0, sync_status: 'pending' }), true)
    assert.equal(H.hideUnconfirmedZero({ platform: 'instagram', followers: 0, sync_status: 'ok' }), false)
    assert.equal(H.hideUnconfirmedZero({ platform: 'tiktok', followers: 0, sync_status: 'pending' }), false)
    assert.match(H.igSyncLabel({ platform: 'instagram', sync_status: 'not_found' })!.text, /No sincronizable/)
    assert.match(H.igSyncLabel({ platform: 'instagram', sync_status: 'pending' })!.text, /pendiente/)
    assert.equal(H.igSyncLabel({ platform: 'tiktok', sync_status: 'pending' }), null)
    const fresh = H.igSyncLabel({ platform: 'instagram', sync_status: 'ok', synced_at: new Date(NOW.getTime() - 3 * 3600_000).toISOString() }, NOW)!
    assert.match(fresh.text, /^Actualizado hace/); assert.equal(fresh.tone, 'muted')
    assert.equal(H.igSyncLabel({ platform: 'instagram', sync_status: 'ok', synced_at: '2026-08-24T00:00:00Z' }, NOW)!.tone, 'warn')
  })
})
