#!/usr/bin/env node
/**
 * Prueba de concurrencia REAL de public.register_brand (P4).
 *
 * Uso (solo contra una rama de pruebas de Supabase, NUNCA producción):
 *   SUPABASE_URL=https://<rama>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *   REGISTERED_BY=<uuid de un usuario existente en esa rama> CONFIRM_BRANCH_REF=<ref de la rama> \
 *   node scripts/test-register-brand-concurrency.mjs
 *
 * Lanza N llamadas simultáneas con la MISMA clave y comprueba: 1 marca,
 * 1 organización, 1 'created' y el resto 'replayed'. Luego N llamadas con
 * claves distintas y el mismo correo: 1 'created' y el resto 'conflict'.
 * Las filas de prueba llevan el prefijo "p4conc-" y se archivan al final
 * (status 'rejected'; no se borra nada).
 */
import { createClient } from '@supabase/supabase-js'

const PRODUCTION_REF = 'xzzbishzfyovrladcaeb'
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const registeredBy = process.env.REGISTERED_BY
if (!url || !key || !registeredBy) { console.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o REGISTERED_BY'); process.exit(2) }
if (url.includes(PRODUCTION_REF)) { console.error('Rechazado: esa URL es producción.'); process.exit(2) }
const ref = new URL(url).hostname.split('.')[0]
if (process.env.CONFIRM_BRANCH_REF !== ref) { console.error(`Confirma la rama: CONFIRM_BRANCH_REF=${ref} (debe ser una rama NO predeterminada de Supabase)`); process.exit(2) }

const admin = createClient(url, key, { auth: { persistSession: false } })
const N = Number(process.env.CONCURRENCY ?? 10)
const tag = `p4conc-${Date.now()}`
const call = (brand, k) => admin.rpc('register_brand', { p_brand: brand, p_registered_by: registeredBy, p_idempotency_key: k, p_owner_user_id: null, p_org: {} })
const rows = r => r.map(x => (Array.isArray(x.data) ? x.data[0] : x.data))
let failed = false
const check = (label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} ${extra}`); if (!ok) failed = true }

const same = await Promise.all(Array.from({ length: N }, () => call({ name: `${tag}-a`, contact_email: `${tag}-a@example.test` }, `${tag}:a`)))
const a = rows(same)
check('misma clave: sin errores', same.every(r => !r.error), JSON.stringify(same.filter(r => r.error).map(r => r.error.message)))
check('misma clave: 1 sola marca', new Set(a.map(r => r?.out_brand_id)).size === 1)
check('misma clave: 1 sola organización', new Set(a.map(r => r?.out_organization_id)).size === 1)
check('misma clave: exactamente 1 created', a.filter(r => r?.out_outcome === 'created').length === 1, JSON.stringify(a.map(r => r?.out_outcome)))

const diff = await Promise.all(Array.from({ length: N }, (_, i) => call({ name: `${tag}-b${i}`, contact_email: `${tag}-b@example.test` }, `${tag}:b${i}`)))
const b = rows(diff)
check('mismo correo, claves distintas: 1 created', b.filter(r => r?.out_outcome === 'created').length === 1, JSON.stringify(b.map(r => r?.out_outcome)))
check('mismo correo: el resto conflict', b.filter(r => r?.out_outcome === 'conflict').length === N - 1)

const { data: leftovers } = await admin.from('brands').select('id, organization_id').like('name', `${tag}%`)
const orgIds = new Set((leftovers ?? []).map(x => x.organization_id))
check('sin organizaciones huérfanas', (leftovers ?? []).length === orgIds.size, `marcas=${leftovers?.length} orgs=${orgIds.size}`)

await admin.from('brands').update({ status: 'rejected' }).like('name', `${tag}%`)
process.exit(failed ? 1 : 0)
