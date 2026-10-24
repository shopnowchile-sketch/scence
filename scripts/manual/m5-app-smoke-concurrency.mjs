#!/usr/bin/env node
// M5 · Smoke test de aislamiento (marcas A y B; C opcional) + concurrencia REAL contra la app local
// conectada EXCLUSIVAMENTE a la rama Supabase dexpvoubiklgotuukrml.
//
//   Desde la raíz del repo:   node scripts/manual/m5-app-smoke-concurrency.mjs
//
// NO crea usuarios ni marcas. Solo crea/borra relaciones ficticias entre marcas de PRUEBA:
//   modo A/B   : A→B (la crea y borra el owner de A)  y  B→A (la crea y borra el owner de B)
//   modo A/B/C : A→B (owner de A)  y  B→C (owner de B)       [C y su member son OPCIONALES]
// Si alguna de esas relaciones ya existe al empezar, ABORTA sin borrar nada. No imprime cookies ni claves.
//
// Variables OBLIGATORIAS (escenario A/B):
//   BRAND_A_ID, BRAND_B_ID                 uuids de dos marcas de prueba distintas y aprobadas
//   IG_A, IG_B                             Instagram de cada una (único entre marcas aprobadas)
//   COOKIE_OWNER_A, COOKIE_MEMBER_A, COOKIE_OWNER_B   cabecera Cookie completa de cada sesión
// OPCIONALES:
//   BRAND_C_ID + IG_C + COOKIE_MEMBER_C    activan las pruebas de la marca C (las tres juntas o ninguna)
//   IG_NONAPPROVED   Instagram de una marca existente NO aprobada (compara 404 uniforme)
//   COOKIE_ADMIN     sesión super_admin
//   BASE_URL         por defecto http://localhost:3000 (solo localhost/127.0.0.1)
//   ROUNDS           rondas de concurrencia, por defecto 10
//   DRY_RUN=1        valida guardas y variables, imprime el plan y sale SIN hacer solicitudes
//   M5_CONFIRM_WRITES=dexpvoubiklgotuukrml   obligatorio para ejecutar de verdad (escribe relaciones ficticias)
//
// Sin C, las pruebas que dependen de C quedan OMITIDAS y se listan como PENDIENTES al final (no son PASS).
// Concurrencia: cada ronda lanza las solicitudes con Promise.all en el mismo tick (HTTP simultáneo real).
// Limitación: un servidor Node intercala en puntos await; no se garantiza solape al milisegundo en la BD.

import { readFileSync } from 'node:fs'

const EXPECTED_REF = 'dexpvoubiklgotuukrml'
const PROD_REF = 'xzzbishzfyovrladcaeb'
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const ROUNDS = Number(process.env.ROUNDS || 10)
const E = process.env
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let failures = 0, passes = 0

const abort = (msg, code = 3) => { console.error('ABORTO: ' + msg); process.exit(code) }
const need = n => E[n] || abort(`falta la variable ${n}`, 2)

// ── 0) Guardas de seguridad (no se pueden desactivar) ────────────────────────────────────────────
let ref
try {
  ref = readFileSync('.env.local', 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=https?:\/\/([a-z0-9]+)\./m)?.[1]
} catch { abort('no se pudo leer .env.local (ejecuta desde la raíz del repo)') }
if (ref === PROD_REF) abort('.env.local apunta a PRODUCCIÓN')
if (ref !== EXPECTED_REF) abort(`ref de .env.local = ${ref ?? 'desconocido'}, se esperaba ${EXPECTED_REF}`)
console.log(`ref de .env.local: ${ref} (OK)`)
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) abort('BASE_URL no es local')

const ids = { A: need('BRAND_A_ID'), B: need('BRAND_B_ID') }
const IG = { A: need('IG_A'), B: need('IG_B') }
const cOpt = ['BRAND_C_ID', 'IG_C', 'COOKIE_MEMBER_C'].filter(n => E[n])
if (cOpt.length !== 0 && cOpt.length !== 3) abort('la marca C requiere BRAND_C_ID, IG_C y COOKIE_MEMBER_C juntos (o ninguno)', 2)
const hasC = cOpt.length === 3
if (hasC) { ids.C = E.BRAND_C_ID; IG.C = E.IG_C }
for (const [k, v] of Object.entries(ids)) if (!UUID.test(v)) abort(`BRAND_${k}_ID no es un uuid válido`, 2)
if (new Set(Object.values(ids)).size !== Object.keys(ids).length) abort('las marcas deben ser distintas entre sí', 2)
const ck = { ownerA: need('COOKIE_OWNER_A'), memberA: need('COOKIE_MEMBER_A'), ownerB: need('COOKIE_OWNER_B'), memberC: E.COOKIE_MEMBER_C, admin: E.COOKIE_ADMIN }

// Segunda relación de prueba, creada y borrada por el owner de B: B→C si hay C; si no, B→A.
const bT = hasC ? { id: ids.C, ig: IG.C, label: 'B→C' } : { id: ids.A, ig: IG.A, label: 'B→A' }
const allIds = Object.values(ids)

if (E.DRY_RUN === '1') {
  console.log(`DRY_RUN: guardas y variables OK. Modo ${hasC ? 'A/B/C' : 'A/B'}. No se hizo ninguna solicitud.`)
  console.log(`Plan: crea A→B (owner A) y ${bT.label} (owner B); prueba aislamiento con member A y owner B; concurrencia ×${ROUNDS}; limpia solo esas dos relaciones.`)
  if (!hasC) console.log('PENDIENTE (omitido): pruebas de la marca C y de brand_member C.')
  process.exit(0)
}
if (E.M5_CONFIRM_WRITES !== EXPECTED_REF) abort(`para escribir exporta M5_CONFIRM_WRITES=${EXPECTED_REF}`, 4)

// ── Utilidades ───────────────────────────────────────────────────────────────────────────────────
const seen = []   // todas las respuestas, para el análisis global de privacidad
async function call(method, path, cookie, body) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) { return { status: 0, json: null, net: e?.name || 'error' } }
  let json = null
  try { json = await res.json() } catch {}
  seen.push({ method, status: res.status, json })
  return { status: res.status, json }
}
const check = (name, ok, detail = '') => {
  if (ok) { passes++; console.log(`PASS  ${name}`) } else { failures++; console.log(`FAIL  ${name} ${detail}`) }
}
const P = '/api/brand/collaborators'
const listIds = async (cookie, q = '') => {
  const r = await call('GET', P + q, cookie)
  return r.status === 200 && Array.isArray(r.json?.data) ? r.json.data.map(x => x.brand?.id) : null
}
const sameSet = (x, y) => x && y && x.length === y.length && [...x].sort().join() === [...y].sort().join()
const postIG = (cookie, instagram, brand_id) => call('POST', P, cookie, brand_id ? { instagram, brand_id } : { instagram })
const del = (cookie, collab, brand_id) => call('DELETE', `${P}?collaborator_brand_id=${collab}${brand_id ? `&brand_id=${brand_id}` : ''}`, cookie)
const only = (json, ...keys) => json && JSON.stringify(Object.keys(json).sort()) === JSON.stringify(keys.sort())
const has5xx = rs => rs.some(x => x.status >= 500 || x.status === 0)
const leaks = json => { const s = JSON.stringify(json ?? {}); return allIds.some(i => s.includes(i)) }

// ── 1) Alcanzabilidad y precondiciones (sin borrar nada) ────────────────────────────────────────
const probe = await call('GET', P, null)
if (probe.status === 0) abort(`la app no responde en ${BASE} (${probe.net}). Inicia "npm run dev" primero.`, 5)
const a0 = await listIds(ck.ownerA), b0 = await listIds(ck.ownerB)
if (!a0) abort('owner A no puede leer la lista de A (sesión inválida o marca no aprobada)', 5)
if (!b0) abort('owner B no puede leer la lista de B (sesión inválida o marca no aprobada)', 5)
if (a0.includes(ids.B)) abort('ya existe la relación A→B: no se borra nada; usa otras marcas de prueba o retírala tú', 6)
if (b0.includes(bT.id)) abort(`ya existe la relación ${bT.label}: no se borra nada; usa otras marcas de prueba o retírala tú`, 6)
console.log(`precondiciones: A→B y ${bT.label} ausentes (OK)`)

async function cleanup() {
  await del(ck.ownerA, ids.B)   // borra únicamente A→B
  await del(ck.ownerB, bT.id)   // borra únicamente la segunda relación de prueba (B→C o B→A)
  const a = await listIds(ck.ownerA), b = await listIds(ck.ownerB)
  check('limpieza: A→B ausente', a && !a.includes(ids.B))
  check(`limpieza: ${bT.label} ausente`, b && !b.includes(bT.id))
}

try {
  // ── 2) Autenticación y validación ────────────────────────────────────────────────────────────
  check('GET sin sesión → 401', (await call('GET', P, null)).status === 401)
  check('POST sin sesión → 401', (await call('POST', P, null, { instagram: IG.B })).status === 401)
  check('POST cuerpo no JSON → 400', (await call('POST', P, ck.ownerA, '{')).status === 400)
  check('POST cuerpo null → 400 (no 500)', (await call('POST', P, ck.ownerA, 'null')).status === 400)
  check('POST Instagram inválido → 422', (await call('POST', P, ck.ownerA, { instagram: '' })).status === 422)
  const nf = await postIG(ck.ownerA, '@m5_no_existe_zzz_9')
  check('POST marca inexistente → 404 brand_not_found_creation_disabled', nf.status === 404 && nf.json?.code === 'brand_not_found_creation_disabled')
  if (E.IG_NONAPPROVED) {
    const na = await postIG(ck.ownerA, E.IG_NONAPPROVED)
    check('marca NO aprobada → 404 idéntico a inexistente', na.status === 404 && JSON.stringify(na.json) === JSON.stringify(nf.json))
  }
  check('owner A: autorelación (A→A) → 422', (await postIG(ck.ownerA, IG.A)).status === 422)
  check('owner B: autorelación (B→B) → 422', (await postIG(ck.ownerB, IG.B)).status === 422)
  check('DELETE uuid inválido → 422', (await call('DELETE', `${P}?collaborator_brand_id=x`, ck.ownerA)).status === 422)
  check('GET brand_id inválido → 422', (await call('GET', `${P}?brand_id=x`, ck.ownerA)).status === 422)

  // ── 3) Owner A crea A→B; direccionalidad y lectura de member A ──────────────────────────────
  let r = await postIG(ck.ownerA, IG.B)
  check('owner A: POST A→B → 201 created:true', r.status === 201 && r.json?.created === true)
  check('respuesta solo id,instagram,logo_url,name (sin status)',
    JSON.stringify(Object.keys(r.json?.data?.brand ?? {}).sort()) === '["id","instagram","logo_url","name"]')
  r = await postIG(ck.ownerA, IG.B)
  check('POST repetido → 200 created:false (idempotente)', r.status === 200 && r.json?.created === false)
  const aIds = await listIds(ck.ownerA)
  check('lista de A contiene B exactamente una vez', aIds && aIds.filter(x => x === ids.B).length === 1)
  if (hasC) check('direccional: A→B no implica A→C', aIds && !aIds.includes(ids.C))
  check('direccional: A→B no implica B→A', (await listIds(ck.ownerB))?.includes(ids.A) === false)
  check('member A lee SU lista (= la de owner A)', sameSet(await listIds(ck.memberA), aIds))
  check('member A POST → 403', (await postIG(ck.memberA, IG.A)).status === 403)
  check('member A DELETE → 403', (await del(ck.memberA, ids.B)).status === 403)
  check('member A no escribió ni borró nada', sameSet(await listIds(ck.ownerA), aIds))
  check('member A GET ?brand_id=B → 403', (await call('GET', `${P}?brand_id=${ids.B}`, ck.memberA)).status === 403)

  // ── 4) Owner B gestiona B sin tocar A; intentos cruzados con brand_id ajeno ─────────────────
  const snapA = await listIds(ck.ownerA)
  r = await postIG(ck.ownerB, bT.ig)
  check(`owner B: POST ${bT.label} → 201 created:true`, r.status === 201 && r.json?.created === true)
  check(`owner B: POST ${bT.label} repetido → 200 created:false`, (await postIG(ck.ownerB, bT.ig)).json?.created === false)
  check(`lista de B contiene ${hasC ? 'C' : 'A'}`, (await listIds(ck.ownerB))?.includes(bT.id) === true)
  check('lista de A NO cambió tras actuar B', sameSet(await listIds(ck.ownerA), snapA))

  const f1 = await postIG(ck.ownerB, bT.ig, ids.A)
  check('owner B POST con brand_id de A → 403', f1.status === 403)
  check('owner B DELETE con brand_id de A → 403', (await del(ck.ownerB, ids.B, ids.A)).status === 403)
  const f1g = await call('GET', `${P}?brand_id=${ids.A}`, ck.ownerB)
  check('owner B GET ?brand_id=A → 403', f1g.status === 403)
  const f2 = await postIG(ck.ownerA, IG.B, ids.B)
  check('owner A POST con brand_id de B → 403', f2.status === 403)
  check('owner A DELETE con brand_id de B → 403', (await del(ck.ownerA, bT.id, ids.B)).status === 403)
  const f3 = await call('GET', `${P}?brand_id=${ids.B}`, ck.ownerA)
  check('owner A GET ?brand_id=B → 403', f3.status === 403)
  check('403 ajeno revela solo {error} (sin datos de la otra marca)',
    [f1, f1g, f2, f3].every(x => only(x.json, 'error') && !leaks(x.json)))
  check(`tras los intentos cruzados A→B y ${bT.label} siguen intactas`,
    (await listIds(ck.ownerA))?.includes(ids.B) === true && (await listIds(ck.ownerB))?.includes(bT.id) === true)

  // ── 5) Member C: sin acceso a las relaciones privadas de A ni de B (solo si C está configurada) ──
  if (hasC) {
    const cOwn = await listIds(ck.memberC)
    check('member C lee SU propia lista → 200', cOwn !== null)
    check('lista de C no contiene ni A ni B (sin fuga de relaciones ajenas)', cOwn && !cOwn.includes(ids.A) && !cOwn.includes(ids.B))
    const c1 = await call('GET', `${P}?brand_id=${ids.A}`, ck.memberC)
    const c2 = await call('GET', `${P}?brand_id=${ids.B}`, ck.memberC)
    check('member C GET ?brand_id=A → 403', c1.status === 403)
    check('member C GET ?brand_id=B → 403', c2.status === 403)
    check('member C POST propio → 403', (await postIG(ck.memberC, IG.A)).status === 403)
    check('member C POST con brand_id de A → 403', (await postIG(ck.memberC, IG.C, ids.A)).status === 403)
    check('member C POST con brand_id de B → 403', (await postIG(ck.memberC, IG.A, ids.B)).status === 403)
    check('member C DELETE con brand_id de A → 403', (await del(ck.memberC, ids.B, ids.A)).status === 403)
    check('member C DELETE con brand_id de B → 403', (await del(ck.memberC, ids.C, ids.B)).status === 403)
    check('member C DELETE propio → 403', (await del(ck.memberC, ids.B)).status === 403)
    check('403 de member C revela solo {error}', [c1, c2].every(x => only(x.json, 'error')))
    check('A→B y B→C siguen intactas tras member C',
      (await listIds(ck.ownerA))?.includes(ids.B) === true && (await listIds(ck.ownerB))?.includes(ids.C) === true)
  }

  if (ck.admin) {
    check('admin GET sin brand_id → 422', (await call('GET', P, ck.admin)).status === 422)
    check('admin GET con brand_id → 200', (await call('GET', `${P}?brand_id=${ids.A}`, ck.admin)).status === 200)
  }

  // ── 6) Borrado e idempotencia, sin cruzar marcas ────────────────────────────────────────────
  check(`owner B DELETE ${bT.label} → 200`, (await del(ck.ownerB, bT.id)).status === 200)
  check('owner B DELETE repetido → 200', (await del(ck.ownerB, bT.id)).status === 200)
  check(`${bT.label} ausente y A→B intacta`, (await listIds(ck.ownerB))?.includes(bT.id) === false && (await listIds(ck.ownerA))?.includes(ids.B) === true)
  check('owner A DELETE A→B → 200', (await del(ck.ownerA, ids.B)).status === 200)
  check('owner A DELETE repetido → 200', (await del(ck.ownerA, ids.B)).status === 200)
  check('A→B ausente', (await listIds(ck.ownerA))?.includes(ids.B) === false)

  // ── 7) CONCURRENCIA REAL ─────────────────────────────────────────────────────────────────────
  const count = async (cookie, id) => (await listIds(cookie))?.filter(x => x === id).length
  for (let i = 1; i <= ROUNDS; i++) {
    await del(ck.ownerA, ids.B)
    const rs = await Promise.all([1, 2, 3, 4].map(() => postIG(ck.ownerA, IG.B)))
    const created = rs.filter(x => x.json?.created === true).length
    const n = await count(ck.ownerA, ids.B)
    check(`ronda ${i}: 4 POST simultáneos A→B → 1 creado, sin 5xx, 1 fila`,
      rs.every(x => x.status === 200 || x.status === 201) && created === 1 && n === 1, `statuses=${rs.map(x => x.status)} created=${created} filas=${n}`)
  }
  for (let i = 1; i <= ROUNDS; i++) {
    await del(ck.ownerA, ids.B)
    if (i % 2 === 0) await postIG(ck.ownerA, IG.B)
    const [p, d] = await Promise.all([postIG(ck.ownerA, IG.B), del(ck.ownerA, ids.B)])
    const n = await count(ck.ownerA, ids.B)
    check(`ronda ${i}: POST+DELETE simultáneos → sin 5xx, estado final coherente (0 o 1 fila)`,
      !has5xx([p, d]) && (p.status === 200 || p.status === 201) && d.status === 200 && (n === 0 || n === 1), `post=${p.status} delete=${d.status} filas=${n}`)
  }
  for (let i = 1; i <= Math.min(ROUNDS, 5); i++) {
    await del(ck.ownerA, ids.B); await del(ck.ownerB, bT.id)
    const rs = await Promise.all([postIG(ck.ownerA, IG.B), postIG(ck.ownerB, bT.ig), postIG(ck.ownerA, IG.B), postIG(ck.ownerB, bT.ig)])
    const nA = await count(ck.ownerA, ids.B), nB = await count(ck.ownerB, bT.id)
    check(`ronda ${i}: POST simultáneos de dos marcas distintas → independientes (1 fila cada una)`,
      !has5xx(rs) && nA === 1 && nB === 1, `statuses=${rs.map(x => x.status)} A→B=${nA} ${bT.label}=${nB}`)
  }
} finally {
  // ── 8) Limpieza estricta de las dos relaciones ficticias + privacidad global ────────────────
  await cleanup()
}

const walk = (o, f) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { f(k, v); walk(v, f) } }
let statusKey = false
for (const s of seen) walk(s.json, k => { if (k === 'status') statusKey = true })
check('ninguna respuesta de toda la ejecución contiene la clave `status`', !statusKey)
check('toda respuesta no exitosa trae solo {error} o {error,code}',
  seen.filter(s => s.status >= 400 && s.json).every(s => only(s.json, 'error') || only(s.json, 'error', 'code')))
console.log(`\nResumen: ${passes} PASS, ${failures} FAIL`)
if (!hasC) console.log('PENDIENTE (omitido, no es PASS): pruebas de la marca C y de brand_member C (falta BRAND_C_ID, IG_C y COOKIE_MEMBER_C).')
process.exit(failures ? 1 : 0)
