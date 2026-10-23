/**
 * Postgres 16 local desechable (no toca Supabase ni producción). Prueba supabase/migrations/20261022170000_restrict_influencers_rls.sql
 * contra réplicas de las 10 políticas de producción que consultan `influencers` (+ brand_influencers, que no la consulta).
 * Uso: en un directorio con `npm i embedded-postgres pg`, usuario NO root, con este archivo en scripts/ del repo:
 *   node scripts/test-rls-influencers-local.mjs
 */
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { readFileSync, rmSync } from 'node:fs'
const MIG = readFileSync(new URL('../supabase/migrations/20261022170000_restrict_influencers_rls.sql', import.meta.url), 'utf8')
const dir = process.env.PGTEST_DIR ?? '/tmp/pgtest4-data'; rmSync(dir, { recursive: true, force: true })
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 54332, persistent: false, onLog: () => {}, onError: () => {} })
await server.initialise(); await server.start(); await server.createDatabase('t')
const c = new pg.Client({ host: 'localhost', port: 54332, user: 'postgres', password: 'pw', database: 't' }); await c.connect()
const U = { mA: '00000000-0000-0000-0000-0000000000a1', mB: '00000000-0000-0000-0000-0000000000b1', inf1: '00000000-0000-0000-0000-000000000011', inf2: '00000000-0000-0000-0000-000000000022', inf0: '00000000-0000-0000-0000-000000000033' }
const OA = '10000000-0000-0000-0000-00000000000a', OB = '10000000-0000-0000-0000-00000000000b'
const I1 = '20000000-0000-0000-0000-000000000001', I2 = '20000000-0000-0000-0000-000000000002', I0 = '20000000-0000-0000-0000-000000000000'
await c.query(`
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
 create table public.organization_members(id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, is_active bool default true);
 create table public.brands(id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid);
 create table public.campaigns(id uuid primary key default gen_random_uuid(), organization_id uuid);
 create table public.influencers(id uuid primary key, user_id uuid, display_name text, organization_id uuid);
 create table public.barters(id uuid primary key default gen_random_uuid(), influencer_id uuid);
 create table public.affiliate_conversions(id uuid primary key default gen_random_uuid(), influencer_id uuid);
 create table public.barter_benefits(id uuid primary key default gen_random_uuid(), barter_id uuid);
 create table public.barter_status_history(id uuid primary key default gen_random_uuid(), barter_id uuid);
 create table public.brand_influencers(id uuid primary key default gen_random_uuid(), brand_id uuid, influencer_id uuid);
 create table public.campaign_assets(id uuid primary key default gen_random_uuid(), campaign_id uuid);
 create table public.campaign_influencers(id uuid primary key default gen_random_uuid(), campaign_id uuid, influencer_id uuid);
 create table public.commission_settlements(id uuid primary key default gen_random_uuid(), influencer_id uuid);
 create table public.influencer_documents(id uuid primary key default gen_random_uuid(), influencer_id uuid);
 create table public.locations(id uuid primary key default gen_random_uuid(), owner_influencer_id uuid);
 create table public.subscription_payments(id uuid primary key default gen_random_uuid(), influencer_id uuid);
 alter table public.influencers enable row level security;
 create policy "influencers_org_read" on public.influencers for all to public using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid() and is_active = true) or organization_id is null);
 -- Réplicas de las políticas de producción (pg_policies, solo lectura):
 alter table public.affiliate_conversions enable row level security;
 create policy affiliate_conversions_influencer_read on public.affiliate_conversions for select to authenticated using (exists (select 1 from influencers i where i.id = affiliate_conversions.influencer_id and i.user_id = auth.uid()));
 alter table public.barter_benefits enable row level security;
 create policy barter_benefits_influencer_read on public.barter_benefits for select to authenticated using (exists (select 1 from barters b join influencers i on i.id = b.influencer_id where b.id = barter_benefits.barter_id and i.user_id = auth.uid()));
 alter table public.barter_status_history enable row level security;
 create policy bsh_influencer_read_own on public.barter_status_history for select to public using (exists (select 1 from barters b join influencers inf on inf.id = b.influencer_id where b.id = barter_status_history.barter_id and inf.user_id = auth.uid()));
 alter table public.barters enable row level security;
 create policy barters_influencer_read_own on public.barters for select to public using (exists (select 1 from influencers inf where inf.id = barters.influencer_id and inf.user_id = auth.uid()));
 alter table public.brand_influencers enable row level security;
 create policy "Brands can read own influencer assignments" on public.brand_influencers for select to authenticated using (exists (select 1 from brands b where b.id = brand_influencers.brand_id and b.user_id = auth.uid()));
 alter table public.campaign_assets enable row level security;
 create policy influencer_read_campaign_assets on public.campaign_assets for select to public using (exists (select 1 from campaign_influencers ci join influencers inf on inf.id = ci.influencer_id where ci.campaign_id = campaign_assets.campaign_id and inf.user_id = auth.uid()));
 alter table public.campaign_influencers enable row level security;
 create policy campaign_influencers_self_read on public.campaign_influencers for all to public using (influencer_id in (select influencers.id from influencers where influencers.user_id = auth.uid()) or campaign_id in (select c.id from campaigns c join organization_members om on om.organization_id = c.organization_id where om.user_id = auth.uid() and om.is_active = true));
 alter table public.commission_settlements enable row level security;
 create policy commission_settlements_influencer_read on public.commission_settlements for select to authenticated using (exists (select 1 from influencers i where i.id = commission_settlements.influencer_id and i.user_id = auth.uid()));
 alter table public.influencer_documents enable row level security;
 create policy influencer_documents_self_read on public.influencer_documents for select to authenticated using (exists (select 1 from influencers i where i.id = influencer_documents.influencer_id and i.user_id = (select auth.uid())));
 alter table public.locations enable row level security;
 create policy locations_influencer_read_own_home on public.locations for select to public using (exists (select 1 from influencers inf where inf.id = locations.owner_influencer_id and inf.user_id = auth.uid()));
 alter table public.subscription_payments enable row level security;
 create policy subscription_payments_influencer_self_read on public.subscription_payments for select to authenticated using (exists (select 1 from influencers i where i.id = subscription_payments.influencer_id and i.user_id = (select auth.uid())));
 grant usage on schema public, auth to anon, authenticated, service_role;
 grant all on all tables in schema public to anon, authenticated, service_role;  -- como en producción: todos los privilegios
 grant execute on function auth.uid() to anon, authenticated, service_role;
 insert into public.organization_members(organization_id,user_id) values ('${OA}','${U.mA}'),('${OB}','${U.mB}');
 insert into public.influencers(id,user_id,display_name,organization_id) values ('${I1}','${U.inf1}','i1','${OA}'),('${I2}','${U.inf2}','i2','${OB}'),('${I0}','${U.inf0}','sin-org',null);
`)
const DEP = [['affiliate_conversions', 'influencer_id'], ['barters', 'influencer_id'], ['commission_settlements', 'influencer_id'], ['influencer_documents', 'influencer_id'], ['subscription_payments', 'influencer_id'], ['locations', 'owner_influencer_id'], ['campaign_influencers', 'influencer_id']]
for (const [t, col] of DEP) for (const i of [I1, I2, I0]) await c.query(`insert into public.${t}(${col}) values ($1)`, [i])
await c.query(`insert into public.barter_benefits(barter_id) select id from public.barters; insert into public.barter_status_history(barter_id) select id from public.barters;
 insert into public.campaigns(id,organization_id) values ('30000000-0000-0000-0000-00000000000a','${OA}'); insert into public.campaign_assets(campaign_id) values ('30000000-0000-0000-0000-00000000000a');
 update public.campaign_influencers set campaign_id='30000000-0000-0000-0000-00000000000a' where influencer_id='${I1}';
 insert into public.brands(id,user_id) values ('40000000-0000-0000-0000-000000000001','${U.mA}'); insert into public.brand_influencers(brand_id,influencer_id) values ('40000000-0000-0000-0000-000000000001','${I1}');`)

// as(role, sub, sql): ejecuta en transacción con SET LOCAL ROLE y hace rollback; devuelve {rows, rowCount, err}
async function as(role, sub, sql) {
  await c.query('begin'); try {
    await c.query(`set local role ${role}`); await c.query(`select set_config('request.jwt.sub', $1, true)`, [sub ?? ''])
    const r = await c.query(sql); return { rows: r.rows, n: r.rowCount, err: null }
  } catch (e) { return { rows: [], n: 0, err: e.message } } finally { await c.query('rollback') }
}
let pass = 0, fail = 0
const ok = (l, v, x = '') => { v ? pass++ : fail++; console.log(`${v ? 'OK  ' : 'FAIL'} ${l} ${v ? '' : x}`) }
const ids = r => r.rows.map(x => x.id).sort().join(',')
const ROLES = { anon: ['anon', null], mA: ['authenticated', U.mA], mB: ['authenticated', U.mB], inf1: ['authenticated', U.inf1], svc: ['service_role', null] }
const ALLT = [...DEP.map(d => d[0]), 'barter_benefits', 'barter_status_history', 'campaign_assets', 'brand_influencers']

// ── ANTES de la migración: foto de qué ve cada rol en cada tabla dependiente ──
const before = {}
for (const [k, [role, sub]] of Object.entries(ROLES)) for (const t of ALLT) before[`${k}|${t}`] = await as(role, sub, `select id from public.${t}`)
const bInf = {}; for (const [k, [role, sub]] of Object.entries(ROLES)) bInf[k] = await as(role, sub, `select id from public.influencers`)
ok('ANTES: anon lee la ficha sin organización (defecto)', bInf.anon.rows.some(r => r.id === I0))
ok('ANTES: anon puede BORRAR esa ficha (defecto)', (await as('anon', null, `delete from public.influencers where id='${I0}'`)).n === 1)
ok('ANTES: anon puede ACTUALIZAR esa ficha (defecto)', (await as('anon', null, `update public.influencers set display_name='x' where id='${I0}'`)).n === 1)

await c.query(MIG)

// ── DESPUÉS: políticas (pg_policies) y privilegios efectivos, por separado ──
const pol = (await c.query(`select policyname, cmd, roles::text r from pg_policies where tablename='influencers' order by 1`)).rows
ok('POLÍTICAS: ya no existe influencers_org_read', !pol.some(p => p.policyname === 'influencers_org_read'))
ok('POLÍTICAS: solo member_read (SELECT) y member_write (ALL), ambas {authenticated}', pol.length === 2 && pol.every(p => p.r === '{authenticated}') && pol.some(p => p.policyname === 'influencers_member_read' && p.cmd === 'SELECT') && pol.some(p => p.policyname === 'influencers_member_write' && p.cmd === 'ALL'), JSON.stringify(pol))
const priv = async (r, p) => (await c.query(`select has_table_privilege($1,'public.influencers',$2) v`, [r, p])).rows[0].v
for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']) ok(`PRIVILEGIOS: anon NO tiene ${p}`, !(await priv('anon', p)))
ok('PRIVILEGIOS: anon CONSERVA SELECT (provisional)', await priv('anon', 'SELECT'))
for (const p of ['TRUNCATE', 'TRIGGER', 'REFERENCES']) ok(`PRIVILEGIOS: authenticated NO tiene ${p}`, !(await priv('authenticated', p)))
for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) ok(`PRIVILEGIOS: authenticated conserva ${p} (limitado por RLS)`, await priv('authenticated', p))
for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) ok(`PRIVILEGIOS: service_role conserva ${p}`, await priv('service_role', p))

// ── DESPUÉS: comportamiento sobre influencers ──
const a = await as('anon', null, `select id from public.influencers`); ok('anon: SELECT sin error y 0 filas', !a.err && a.n === 0, a.err)
for (const [sql, l] of [[`insert into public.influencers(id,display_name,organization_id) values (gen_random_uuid(),'h','${OA}')`, 'INSERT'], [`update public.influencers set display_name='h'`, 'UPDATE'], [`delete from public.influencers`, 'DELETE'], [`truncate public.influencers`, 'TRUNCATE']]) { const r = await as('anon', null, sql); ok(`anon: ${l} → permission denied`, /permission denied/.test(r.err ?? ''), r.err) }
ok('anon: la ficha sin organización sigue existiendo', (await c.query(`select 1 from public.influencers where id='${I0}'`)).rowCount === 1)
let r = await as('authenticated', U.mA, `select id from public.influencers`); ok('miembro A: ve solo las fichas de su organización (no las de B ni la sin organización)', ids(r) === I1, ids(r))
r = await as('authenticated', U.mB, `select id from public.influencers`); ok('miembro B: ve solo las de B', ids(r) === I2, ids(r))
r = await as('authenticated', U.mA, `update public.influencers set display_name='h' where id in ('${I2}','${I0}')`); ok('miembro A: no modifica fichas de B ni sin organización (0 filas)', !r.err && r.n === 0, r.err)
r = await as('authenticated', U.mA, `delete from public.influencers where id in ('${I2}','${I0}')`); ok('miembro A: no borra fichas de B ni sin organización (0 filas)', !r.err && r.n === 0, r.err)
r = await as('authenticated', U.mA, `insert into public.influencers(id,display_name,organization_id) values (gen_random_uuid(),'h','${OB}')`); ok('miembro A: no inserta en la organización B (RLS)', /row-level security/.test(r.err ?? ''), r.err)
r = await as('authenticated', U.mA, `insert into public.influencers(id,display_name,organization_id) values (gen_random_uuid(),'h',null)`); ok('miembro A: no inserta ficha sin organización (RLS)', /row-level security/.test(r.err ?? ''), r.err)
r = await as('authenticated', U.mA, `update public.influencers set display_name='h' where id='${I1}'`); ok('miembro A: sí modifica fichas de su organización (paridad)', r.n === 1, r.err)
r = await as('authenticated', U.mA, `update public.influencers set organization_id='${OB}' where id='${I1}'`); ok('miembro A: no puede mover una ficha a otra organización (WITH CHECK)', /row-level security/.test(r.err ?? ''), r.err)
r = await as('authenticated', U.mA, `truncate public.influencers`); ok('authenticated: TRUNCATE → permission denied', /permission denied/.test(r.err ?? ''), r.err)
r = await as('authenticated', U.inf1, `select id from public.influencers`); ok('influencer no miembro: 0 fichas por PostgREST (igual que antes)', r.n === 0 && bInf.inf1.n === 1 /* antes veía solo la sin org */ , `${r.n}/${bInf.inf1.n}`)
r = await as('service_role', null, `select id from public.influencers`); ok('service_role: ve las 3 fichas (incl. sin organización)', r.n === 3)
r = await as('service_role', null, `update public.influencers set display_name='svc' where id='${I0}'`); ok('service_role: escribe fichas', r.n === 1, r.err)

// ── DESPUÉS: las tablas dependientes (sin error; mismo resultado salvo la ficha sin organización) ──
for (const t of ALLT) for (const [k, [role, sub]] of Object.entries(ROLES)) {
  const af = await as(role, sub, `select id from public.${t}`)
  ok(`${t} / ${k}: la consulta no falla (${af.err ?? 'ok'})`, !af.err, af.err)
  if (k === 'svc' || t === 'brand_influencers' || t === 'campaign_assets' && false) ok(`${t} / ${k}: resultado idéntico`, ids(af) === ids(before[`${k}|${t}`]), `${ids(af)} vs ${ids(before[`${k}|${t}`])}`)
}
// Regresión explícita: anon sin SELECT (REVOKE ALL) rompería las dependientes
await c.query('revoke select on public.influencers from anon')
const broken = await as('anon', null, `select id from public.barters`); ok('CONTRASTE: sin SELECT de anon, una dependiente falla (por eso se conserva)', /permission denied/.test(broken.err ?? ''), broken.err)
await c.query('grant select on public.influencers to anon')
// Diferencias antes/después en dependientes para roles no service: solo permitidas si dependían de la ficha sin org
let diffs = []
for (const t of ALLT) for (const k of ['anon', 'mA', 'mB', 'inf1']) { const [role, sub] = ROLES[k]; const af = await as(role, sub, `select id from public.${t}`); if (ids(af) !== ids(before[`${k}|${t}`])) diffs.push(`${k}|${t}`) }
console.log('INFO diferencias antes/después en dependientes:', diffs.length ? diffs.join(', ') : 'ninguna')
// ── PROPUESTA (no aplicada): influencers_self_read. Se prueba sobre la base local, tras la migración ──
await c.query(readFileSync(new URL('../docs/audits/PROPUESTA_influencer_self_read_2026-10-22.sql', import.meta.url), 'utf8'))
r = await as('authenticated', U.inf1, `select id from public.influencers`); ok('SELF-READ: la influencer ve solo su ficha', ids(r) === I1, ids(r))
r = await as('authenticated', U.inf1, `select 1 from public.organization_members where user_id='${U.inf1}'`); ok('SELF-READ: sin membresía en ninguna organización (no se hizo miembro)', r.n === 0)
r = await as('authenticated', U.inf1, `update public.influencers set display_name='h' where id='${I1}'`); ok('SELF-READ: no puede escribir su ficha', r.n === 0 && !r.err, r.err)
r = await as('authenticated', U.inf1, `delete from public.influencers where id='${I1}'`); ok('SELF-READ: no puede borrar su ficha', r.n === 0 && !r.err, r.err)
r = await as('authenticated', U.inf1, `select id from public.influencers where id in ('${I2}','${I0}')`); ok('SELF-READ: no ve fichas ajenas ni sin organización', r.n === 0)
r = await as('anon', null, `select id from public.influencers`); ok('SELF-READ: anon sigue con 0 filas', r.n === 0)
r = await as('authenticated', U.inf1, `select id from public.affiliate_conversions`); ok('SELF-READ: sus propias lecturas dependientes ahora funcionan y solo devuelven lo suyo', r.n === 1, String(r.n))
r = await as('authenticated', U.mA, `select id from public.influencers`); ok('SELF-READ: el miembro A no ve nada nuevo', ids(r) === I1, ids(r))
console.log(`\n${pass} OK, ${fail} FAIL`); await c.end(); await server.stop(); process.exit(fail ? 1 : 0)
