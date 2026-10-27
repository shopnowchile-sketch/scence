/**
 * Prueba de concurrencia REAL de public.register_brand en un Postgres local desechable
 * (no toca Supabase, ni la rama de pruebas, ni producción). Carga la migración EXACTA sobre
 * un esquema mínimo equivalente (brands/organizations/members, índices únicos y trigger de
 * dueño) y dispara N sesiones simultáneas (conexiones distintas, barrera común) por escenario.
 *
 * Uso (Postgres no corre como root; usar un usuario normal):
 *   mkdir /tmp/pgt && cd /tmp/pgt && npm init -y && npm i embedded-postgres pg
 *   cp <repo>/scripts/test-register-brand-concurrency-local.mjs . ; (ajustar la ruta de la migración si no está en ../supabase)
 *   node test-register-brand-concurrency-local.mjs            # ROUNDS=25 por defecto
 *   NOLOCK=1 ROUNDS=10 node ...                               # control negativo: sin advisory locks
 * Limitación: es un esquema réplica, no la rama real; no cubre otras restricciones de producción.
 */
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { readFileSync, rmSync } from 'node:fs'
let MIG = readFileSync(new URL('../supabase/migrations/20261022160000_register_brand_atomic.sql', import.meta.url), 'utf8')
if (process.env.NOLOCK) MIG = MIG.replace(/perform pg_advisory_xact_lock\([^;]*\);/g, 'null;')
const dir = process.env.PGTEST_DIR ?? '/tmp/pgtest-data'; rmSync(dir, { recursive: true, force: true })
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 54329, persistent: false })
await server.initialise(); await server.start(); await server.createDatabase('t')
const mk = () => new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'pw', database: 't' })
const admin = mk(); await admin.connect()
await admin.query(`
 create role service_role nologin; create role anon nologin; create role authenticated nologin;
 create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
 create table public.organizations(id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null, type text not null, logo_url text, country text);
 create table public.organization_members(id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations on delete cascade, user_id uuid, role text, is_owner bool, is_active bool default true, brand_id uuid, unique(organization_id,user_id));
 create table public.brands(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade, created_by uuid references auth.users, name text not null, logo_url text, website text, industry text, contact_name text, contact_email text, contact_phone text, notes text, created_at timestamptz default now(), updated_at timestamptz default now(), user_id uuid references auth.users on delete set null, additional_contacts jsonb default '[]', rut text, instagram text, status text not null default 'pending_approval' check (status in ('pending_approval','approved','rejected','suspended')), metadata jsonb not null default '{}', subscription_plan_override text, referred_by_influencer_id uuid, address_lat numeric, instagram_handle_normalized text);
 create unique index brands_instagram_handle_normalized_unique on public.brands(instagram_handle_normalized) where instagram_handle_normalized is not null;
 create unique index brands_user_id_unique on public.brands(user_id) where user_id is not null;
 create function public.ensure_brand_owner_org_membership() returns trigger language plpgsql as $$ begin if new.user_id is not null then insert into public.organization_members(organization_id,user_id,role,is_owner,brand_id) values (new.organization_id,new.user_id,'brand_manager',true,new.id) on conflict do nothing; end if; return new; end $$;
 create trigger trg_ensure_brand_owner_org_membership after insert or update of user_id, organization_id on public.brands for each row execute function public.ensure_brand_owner_org_membership();
`)
await admin.query(`alter role service_role bypassrls; grant usage on schema public, auth to service_role; grant all on all tables in schema public to service_role; grant all on all tables in schema auth to service_role;`)
await admin.query(MIG)
const U = async n => { const r = await admin.query(`insert into auth.users default values returning id`); return r.rows[0].id }
const by = await U()
const N = 12, ROUNDS = Number(process.env.ROUNDS ?? 25)
const results = []
const check = (label, ok, extra='') => { results.push({ label, ok, extra }); console.log(`${ok?'OK  ':'FAIL'} ${label} ${extra}`) }
async function fire(calls) { // calls: array of [sql, params]; sesiones distintas, disparo simultáneo
  const clients = await Promise.all(calls.map(async () => { const c = mk(); await c.connect(); await c.query('set role service_role'); return c }))
  const go = Promise.withResolvers(); const ready = clients.map(() => Promise.withResolvers())
  const runs = clients.map(async (c, i) => { ready[i].resolve(); await go.promise; try { const r = await c.query(...calls[i]); return { row: r.rows[0] } } catch (e) { return { err: e.message } } })
  await Promise.all(ready.map(r => r.promise)); go.resolve()
  const out = await Promise.all(runs); await Promise.all(clients.map(c => c.end())); return out
}
const rpc = (brand, key, owner = null) => ['select * from public.register_brand($1::jsonb,$2::uuid,$3,$4::uuid,\'{}\'::jsonb)', [JSON.stringify(brand), by, key, owner]]
const count = async (sql, p=[]) => Number((await admin.query(sql, p)).rows[0].c)
const tally = o => o.reduce((a, x) => { const k = x.err ? 'ERROR:' + x.err : x.row.out_outcome; a[k] = (a[k] ?? 0) + 1; return a }, {})

let A = { bad: 0 }, B = { bad: 0 }, D = { bad: 0 }, E = { bad: 0 }, F = { bad: 0 }, G = { bad: 0 }
for (let r = 0; r < ROUNDS; r++) {
  const t = `r${r}`
  // A: misma clave y mismo correo → 1 created + N-1 replayed
  let o = await fire(Array.from({ length: N }, () => rpc({ name: `A ${t}`, contact_email: `a${t}@x.cl` }, `A:${t}`)))
  let ta = tally(o); if (ta.created !== 1 || ta.replayed !== N - 1 || Object.keys(ta).length !== 2) A.bad++, A.last = ta
  if (await count(`select count(*) c from brands where metadata->>'registration_key'=$1`, [`A:${t}`]) !== 1) A.bad++
  // B: claves distintas, mismo correo → 1 created + N-1 conflict
  o = await fire(Array.from({ length: N }, (_, i) => rpc({ name: `B ${t} ${i}`, contact_email: `B${t}@X.cl` }, `B:${t}:${i}`)))
  let tb = tally(o); if (tb.created !== 1 || tb.conflict !== N - 1 || Object.keys(tb).length !== 2) B.bad++, B.last = tb
  // D: mismo nombre (colisión de slug), correos distintos → N created, N slugs distintos, sin errores
  o = await fire(Array.from({ length: N }, (_, i) => rpc({ name: `Mismo Nombre ${t}`, contact_email: `d${t}-${i}@x.cl` }, `D:${t}:${i}`)))
  let td = tally(o); if (td.created !== N || Object.keys(td).length !== 1) D.bad++, D.last = td
  // E: autorregistro, mismo dueño → 1 marca, 1 org, 1 membresía
  const owner = await U()
  o = await fire(Array.from({ length: N }, () => rpc({ name: `E ${t}`, contact_email: `e${t}@x.cl` }, `self:${owner}`, owner)))
  let te = tally(o); if (te.created !== 1 || te.replayed !== N - 1) E.bad++, E.last = te
  if (await count(`select count(*) c from brands where user_id=$1`, [owner]) !== 1 || await count(`select count(*) c from organization_members where user_id=$1`, [owner]) !== 1) E.bad++
  // G: mismo Instagram, claves distintas → 1 created, resto conflict
  o = await fire(Array.from({ length: N }, (_, i) => rpc({ name: `G ${t} ${i}`, instagram_handle_normalized: `ig_${t}` }, `G:${t}:${i}`)))
  let tg = tally(o); if (tg.created !== 1 || tg.conflict !== N - 1) G.bad++, G.last = tg
  // F: fallo a mitad (valor inválido en la marca) → error y NINGUNA org huérfana
  const before = await count(`select count(*) c from organizations`)
  o = await fire(Array.from({ length: 4 }, (_, i) => rpc({ name: `F ${t} ${i}`, address_lat: 'no-numero' }, `F:${t}:${i}`)))
  if (!o.every(x => x.err) || await count(`select count(*) c from organizations`) !== before) F.bad++
}
const orphan = await count(`select count(*) c from organizations o where not exists (select 1 from brands b where b.organization_id=o.id)`)
const dupSlugs = await count(`select count(*) c from (select slug from organizations group by slug having count(*)>1) s`)
const dupKeys = await count(`select count(*) c from (select metadata->>'registration_key' k from brands where metadata ? 'registration_key' group by 1 having count(*)>1) s`)
const nonPending = await count(`select count(*) c from brands where status<>'pending_approval'`)
const tot = await admin.query(`select (select count(*) from brands) brands, (select count(*) from organizations) orgs`)
console.log(`\nRondas=${ROUNDS} sesiones simultáneas por escenario=${N}`)
for (const [k, v, d] of [['A misma clave', A, 'created=1, replayed=N-1'], ['B mismo correo, claves distintas', B, 'created=1, conflict=N-1'], ['D colisión de slug', D, 'N created, sin errores'], ['E autorregistro mismo dueño', E, '1 marca, 1 org, 1 membresía'], ['G mismo Instagram', G, 'created=1, conflict=N-1'], ['F fallo a mitad (4 sesiones)', F, 'todas fallan, 0 orgs nuevas']])
  check(`${k} [${d}] rondas con desvío: ${v.bad}/${ROUNDS}`, v.bad === 0, v.last ? JSON.stringify(v.last) : '')
check('organizaciones huérfanas = 0', orphan === 0, `(${orphan})`)
check('slugs duplicados = 0', dupSlugs === 0)
check('claves de idempotencia duplicadas = 0', dupKeys === 0)
check('todas las marcas nacen pending_approval', nonPending === 0)
check('quien registra (registered_by) NO recibe membresía', await count(`select count(*) c from organization_members where user_id=$1`, [by]) === 0)
console.log('Totales:', JSON.stringify(tot.rows[0]))
await admin.end(); await server.stop()
process.exit(results.every(r => r.ok) ? 0 : 1)
