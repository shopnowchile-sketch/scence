/**
 * Pruebas en un Postgres 16 local desechable (no toca Supabase ni producción):
 *  - PROPUESTA_archivar_filas_p4conc: camino feliz, reversión y 8 casos que deben abortar sin cambios.
 *  - Migración 20261022150000 (ensure_brand_member_org_membership): defecto previo, idempotencia,
 *    member sigue member, owner y super_admin no se degradan.
 * Uso: en un directorio temporal con `npm i embedded-postgres pg`, como usuario NO root, con este
 * archivo dentro de scripts/ del repo (lee ../docs y ../supabase):  node scripts/<este archivo>
 */
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { readFileSync, rmSync } from 'node:fs'
const ARCH = readFileSync(new URL('../docs/audits/PROPUESTA_archivar_filas_p4conc_2026-10-22.sql', import.meta.url), 'utf8')
const MIG150 = readFileSync(new URL('../supabase/migrations/20261022150000_preserve_brand_member_role_sync.sql', import.meta.url), 'utf8')
const REV = ARCH.slice(ARCH.indexOf('-- begin;\n-- do $$ declare nb')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- Nota')).map(l => l.slice(3)).join('\n')
const dir = process.env.PGTEST_DIR ?? '/tmp/pgtest2-data'; rmSync(dir, { recursive: true, force: true })
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 54330, persistent: false, onLog: () => {}, onError: () => {} })
await server.initialise(); await server.start(); await server.createDatabase('t')
const c = new pg.Client({ host: 'localhost', port: 54330, user: 'postgres', password: 'pw', database: 't' }); await c.connect()
const B = ['afa991d0-cd3d-47dc-878d-aae564730ebc','b1d13e82-b367-4039-b5d2-8d24c8d9e2cd','168087b7-5e08-4fd7-be35-f9012e2bb99f']
const O = ['29478253-af51-4152-80ff-135e4212cf24','fc1facbf-fe4b-4d83-88a0-34677021f4da','7a654f81-1037-4afe-9dfb-b8a585149ce9']
const CR = '8190c816-aebf-41cb-8414-aec348797a67'
await c.query(`
 create role anon; create role authenticated; create type public.user_role as enum ('super_admin','agency_manager','brand_manager','influencer','finance','member');
 create table public.organizations(id uuid primary key default gen_random_uuid(), slug text unique, name text, is_active boolean default true, updated_at timestamptz default now());
 create function public.update_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
 create trigger trg_updated_at before update on public.organizations for each row execute function public.update_updated_at();
 create table public.brands(id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade, name text, status text default 'pending_approval', created_by uuid, user_id uuid, metadata jsonb not null default '{}', updated_at timestamptz default now());
 create table public.organization_members(id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations, user_id uuid, role public.user_role, is_owner bool default false, is_active bool default true, invited_at timestamptz, joined_at timestamptz, brand_id uuid references public.brands, unique(organization_id,user_id));
 create table public.campaigns(id uuid primary key default gen_random_uuid(), brand_id uuid references public.brands, organization_id uuid references public.organizations);
 create table public.brand_members(id uuid primary key default gen_random_uuid(), brand_id uuid references public.brands, user_id uuid, role text, is_active bool default true, invited_at timestamptz, joined_at timestamptz);
`)
let pass = 0, fail = 0
const ok = (l, v, x='') => { v ? pass++ : fail++; console.log(`${v?'OK  ':'FAIL'} ${l} ${x}`) }
async function seed() {
  await c.query('truncate public.organization_members, public.campaigns, public.brand_members, public.brands, public.organizations cascade')
  for (let i = 0; i < 3; i++) {
    await c.query(`insert into organizations(id,slug,name) values ($1,$2,$3)`, [O[i], `p4conc-${i}`, `p4conc ${i}`])
    await c.query(`insert into brands(id,organization_id,name,created_by,metadata) values ($1,$2,$3,$4,$5)`, [B[i], O[i], `p4conc ${i}`, CR, JSON.stringify({ registration_key: `p4conc-${i}` })])
  }
  for (let i = 0; i < 5; i++) { const o = (await c.query(`insert into organizations(slug,name) values ($1,$1) returning id`, [`real-${i}`])).rows[0].id; await c.query(`insert into brands(organization_id,name,status,created_by,metadata) values ($1,$2,'approved',$3,'{"x":1}')`, [o, `Real ${i}`, CR]) }
}
const snap = async () => (await c.query(`select md5(string_agg(to_jsonb(b)::text,'|' order by id)) h, count(*) n from brands b where name not like 'p4conc%'`)).rows[0]
const snapO = async () => (await c.query(`select md5(string_agg(to_jsonb(o)::text,'|' order by id)) h from organizations o where slug not like 'p4conc-%'`)).rows[0].h
const state = async () => (await c.query(`select (select count(*) from brands where status='rejected') rej, (select count(*) from organizations where not is_active) inact`)).rows[0]
async function run(sql) { try { await c.query(sql); return null } catch (e) { await c.query('rollback').catch(()=>{}); return e.message } }

// 1 camino feliz
await seed(); let s0 = await snap(), o0 = await snapO()
let err = await run(ARCH); let st = await state()
ok('archivado feliz: sin error', !err, err ?? '')
ok('archivado feliz: 3 marcas rejected y 3 orgs inactivas', st.rej == 3 && st.inact == 3, JSON.stringify(st))
ok('archivado feliz: resto de marcas idéntico', JSON.stringify(await snap()) === JSON.stringify(s0))
ok('archivado feliz: resto de organizaciones idéntico', (await snapO()) === o0)
ok('archivado feliz: metadata.test_row en las 3', (await c.query(`select count(*) n from brands where metadata->>'test_row'='true'`)).rows[0].n == 3)
// reversión
err = await run(REV); st = await state()
ok('reversión: sin error', !err, err ?? '')
ok('reversión: 0 rejected y 0 inactivas', st.rej == 0 && st.inact == 0, JSON.stringify(st))
ok('reversión: metadata sin test_row', (await c.query(`select count(*) n from brands where metadata ? 'test_row'`)).rows[0].n == 0)
ok('reversión: resto idéntico', JSON.stringify(await snap()) === JSON.stringify(s0) && (await snapO()) === o0)

// 2 abortos: nada cambia
const cases = [
  ['dependencia (membresía en una org)', async () => c.query(`insert into organization_members(organization_id,user_id,role) values ($1,gen_random_uuid(),'member')`, [O[1]]), /dependencia/],
  ['dependencia (campaña de una marca)', async () => c.query(`insert into campaigns(brand_id) values ($1)`, [B[2]]), /dependencia/],
  ['marca ajena dentro de una org', async () => c.query(`insert into brands(organization_id,name,created_by) values ($1,'Intrusa',$2)`, [O[0], CR]), /marcas ajenas/],
  ['creador distinto', async () => c.query(`update brands set created_by=gen_random_uuid() where id=$1`, [B[0]]), /precondición: se esperaban 3 marcas/],
  ['una marca ya aprobada', async () => c.query(`update brands set status='approved' where id=$1`, [B[1]]), /precondición: se esperaban 3 marcas/],
  ['una marca ligada a un usuario', async () => c.query(`update brands set user_id=gen_random_uuid() where id=$1`, [B[2]]), /precondición: se esperaban 3 marcas/],
  ['par marca→organización cruzado', async () => c.query(`update brands set organization_id=$1 where id=$2`, [O[1], B[0]]), /pares|ajenas|dependencia/],
  ['organización ya inactiva', async () => c.query(`update organizations set is_active=false where id=$1`, [O[0]]), /organizaciones p4conc activas/],
]
for (const [label, mutate, re] of cases) {
  await seed(); await mutate(); const b = JSON.stringify(await c.query('select brands.id, brands.status, o.is_active from brands join organizations o on o.id=brands.organization_id order by brands.id').then(r=>r.rows))
  const e = await run(ARCH)
  const after = JSON.stringify(await c.query('select brands.id, brands.status, o.is_active from brands join organizations o on o.id=brands.organization_id order by brands.id').then(r=>r.rows))
  ok(`aborta: ${label}`, !!e && re.test(e) && b === after, e ?? 'SIN ERROR')
}

// 3 migración 150000
await seed()
await c.query(`create or replace function public.ensure_brand_member_org_membership() returns trigger language plpgsql security definer set search_path=public as $$
declare v_org_id uuid; v_role public.user_role; begin
 if new.user_id is null or coalesce(new.is_active,false)=false then return new; end if;
 select b.organization_id into v_org_id from public.brands b where b.id=new.brand_id; if v_org_id is null then return new; end if;
 v_role := case when new.role='finance' then 'finance'::public.user_role else 'brand_manager'::public.user_role end;
 insert into public.organization_members(organization_id,user_id,role,is_owner,is_active,invited_at,joined_at,brand_id) values (v_org_id,new.user_id,v_role,false,true,new.invited_at,coalesce(new.joined_at,now()),new.brand_id)
 on conflict (organization_id,user_id) do update set is_active=true, role=excluded.role, brand_id=coalesce(public.organization_members.brand_id,excluded.brand_id); return new; end $$;
 create trigger trg_ensure_brand_member_org_membership after insert or update of user_id,brand_id,is_active,role on public.brand_members for each row execute function public.ensure_brand_member_org_membership();`)
const U = () => c.query('select gen_random_uuid() id').then(r => r.rows[0].id)
const [m1, m2, owner, sa] = [await U(), await U(), await U(), await U()]
await c.query(`insert into organization_members(organization_id,user_id,role,is_owner) values ($1,$2,'brand_manager',true),($1,$3,'super_admin',false)`, [O[0], owner, sa])
const roleOf = async (org, u) => (await c.query('select role::text r, is_owner from organization_members where organization_id=$1 and user_id=$2', [org, u])).rows[0]
await c.query(`insert into brand_members(brand_id,user_id,role) values ($1,$2,'member')`, [B[0], m1])
ok('ANTES de 150000: member se promueve a brand_manager (defecto)', (await roleOf(O[0], m1)).r === 'brand_manager')
await c.query(`insert into brand_members(brand_id,user_id,role) values ($1,$2,'finance')`, [B[0], owner])
ok('ANTES de 150000: el owner puede degradarse (defecto)', (await roleOf(O[0], owner)).r === 'finance')
await c.query(`update organization_members set role='brand_manager' where organization_id=$1 and user_id=$2`, [O[0], owner])
await c.query(MIG150); await c.query(MIG150)
ok('150000 es idempotente (se aplica 2 veces sin error)', true)
await c.query(`insert into brand_members(brand_id,user_id,role) values ($1,$2,'member')`, [B[1], m2])
ok('DESPUÉS: member permanece member', (await roleOf(O[1], m2)).r === 'member')
await c.query(`update brand_members set role='finance' where user_id=$1`, [owner]); await c.query(`insert into brand_members(brand_id,user_id,role) values ($1,$2,'finance') on conflict do nothing`, [B[0], owner])
await c.query(`update brand_members set is_active=true where user_id=$1`, [owner])
ok('DESPUÉS: el owner no se degrada', (await roleOf(O[0], owner)).r === 'brand_manager' && (await roleOf(O[0], owner)).is_owner === true)
await c.query(`insert into brand_members(brand_id,user_id,role) values ($1,$2,'member')`, [B[0], sa])
ok('DESPUÉS: super_admin no se degrada', (await roleOf(O[0], sa)).r === 'super_admin')
await c.query(`insert into brand_members(brand_id,user_id,role) values ($1,$2,'owner')`, [B[2], await U()])
ok('DESPUÉS: rol brand_manager/owner de brand_members sigue mapeando a brand_manager', (await c.query(`select count(*) n from organization_members where organization_id=$1 and role='brand_manager'`, [O[2]])).rows[0].n == 1)
console.log(`\nRESUMEN: ${pass} OK, ${fail} FAIL`)
await c.end(); await server.stop(); process.exit(fail ? 1 : 0)
