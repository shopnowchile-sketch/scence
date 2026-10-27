/**
 * Postgres 16 local desechable (no toca Supabase ni producción). Prueba las PROPUESTAS:
 *  - PROPUESTA_handle_new_user_sin_scence_spa_2026-10-22.sql
 *  - PROPUESTA_rls_influencers_2026-10-22.sql
 * Uso: en un directorio con `npm i embedded-postgres pg`, usuario NO root, con este archivo en scripts/ del repo:
 *   node scripts/test-handle-new-user-and-rls-local.mjs
 */
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import { readFileSync, rmSync } from 'node:fs'
const rd = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const OLD = rd('../supabase/migrations/20261005170000_remove_legacy_commune_signup_write.sql')
const NEW = rd('../docs/audits/PROPUESTA_handle_new_user_sin_scence_spa_2026-10-22.sql')
const RLS = rd('../docs/audits/PROPUESTA_rls_influencers_2026-10-22.sql')
const ORIG_POLICY = `create policy "influencers_org_read" on public.influencers for all to public using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid() and is_active = true) or organization_id is null);`
const dir = process.env.PGTEST_DIR ?? '/tmp/pgtest3-data'; rmSync(dir, { recursive: true, force: true })
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 54331, persistent: false, onLog: () => {}, onError: () => {} })
await server.initialise(); await server.start(); await server.createDatabase('t')
const c = new pg.Client({ host: 'localhost', port: 54331, user: 'postgres', password: 'pw', database: 't' }); await c.connect()
await c.query(`
 create role anon; create role authenticated;
 create schema auth;
 create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
 create type public.user_role as enum ('super_admin','brand_manager','influencer','finance','member');
 create type public.social_platform as enum ('instagram','tiktok');
 create table public.organizations(id uuid primary key default gen_random_uuid(), name text, type text, created_at timestamptz default now());
 create table public.brands(id uuid primary key default gen_random_uuid(), organization_id uuid, name text);
 create table public.organization_members(id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, is_active bool default true);
 create table public.profiles(id uuid primary key, full_name text, display_name text, role public.user_role);
 create table public.locations(id uuid primary key default gen_random_uuid(), level text, is_active bool default true);
 create table public.influencers(id uuid primary key default gen_random_uuid(), user_id uuid, email text, display_name text, location_id uuid, address text, birth_date date, is_active bool default true, organization_id uuid, metadata jsonb, created_at timestamptz default now());
 create table public.influencer_social_profiles(id uuid primary key default gen_random_uuid(), influencer_id uuid, platform public.social_platform, username text, profile_url text, followers int, is_primary bool, updated_at timestamptz, unique(influencer_id, platform));
 alter table public.influencers enable row level security;
 grant usage on schema public, auth to anon, authenticated;
 grant all on public.influencers, public.organization_members to anon, authenticated;
 grant execute on function auth.uid() to anon, authenticated;
 create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
`.replace('create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();', ''))
let pass = 0, fail = 0
const ok = (l, v, x = '') => { v ? pass++ : fail++; console.log(`${v ? 'OK  ' : 'FAIL'} ${l} ${x}`) }
const fnSql = s => s.slice(s.indexOf('create or replace function public.handle_new_user()'))
const loc = (await c.query(`insert into public.locations(level) values ('commune') returning id`)).rows[0].id
const meta = (extra = {}) => JSON.stringify({ is_influencer: true, display_name: 'Ana', instagram_username: '@ana', location_id: loc, address: 'Calle 1', birth_date: '1990-01-01', ...extra })
const signup = async (email, extra) => (await c.query(`insert into auth.users(email, raw_user_meta_data) values ($1,$2) returning id`, [email, meta(extra)])).rows[0].id
const orgOf = async id => (r => r ? r.organization_id : 'NOROW')((await c.query(`select organization_id from public.influencers where user_id=$1`, [id])).rows[0])
async function trigger() { await c.query('drop trigger if exists on_auth_user_created on auth.users; create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()') }

// ── A. Definición ACTUAL (defecto) ──
await c.query(fnSql(OLD)); await trigger()
const s1 = (await c.query(`insert into public.organizations(name,type) values ('Scence SpA','agency') returning id`)).rows[0].id
await c.query(`insert into public.organizations(name,type, created_at) values ('SCENCE SPA','agency', now() + interval '1 day')`)
const a1 = await signup('a1@x.cl')
ok('ACTUAL: autorregistro se asigna a «Scence SpA» por nombre (más antigua de 2 homónimas)', await orgOf(a1) === s1)
await c.query(`delete from public.organizations`)
let threw = ''; try { await signup('a2@x.cl') } catch (e) { threw = e.message }
ok('ACTUAL: sin esa organización el registro entero aborta', threw.includes('SCENCE_MAIN_ORG_NOT_FOUND'), threw)

// ── B. Definición PROPUESTA (v2: contenedor explícito, sin nombre ni antigüedad) ──
await c.query('delete from public.influencer_social_profiles; delete from public.influencers; delete from public.profiles; delete from auth.users; delete from public.organizations')
await c.query(NEW.slice(0, NEW.indexOf('create or replace function public.handle_new_user()'))) // columna, índice, disparador
await c.query(fnSql(NEW).slice(0, fnSql(NEW).indexOf('\n-- ── DESIGNACIÓN'))); await trigger()
const countOrgs = async () => +(await c.query('select count(*) from public.organizations')).rows[0].count
const hom1 = (await c.query(`insert into public.organizations(name,type) values ('Scence SpA','agency') returning id`)).rows[0].id
await c.query(`insert into public.organizations(name,type) values ('SCENCE SPA','agency')`)
const brandOrg = (await c.query(`insert into public.organizations(name,type) values ('Marca X','brand') returning id`)).rows[0].id
const org0 = await countOrgs()
const b1 = await signup('b1@x.cl')
ok('NUEVA: sin organización designada el registro funciona y queda NULL (aunque existan «Scence SpA»/«SCENCE SPA»)', await orgOf(b1) === null)
const b3a = await (async () => { await c.query(`insert into public.influencers(email, display_name, organization_id) values ('inv@x.cl','Inv',$1)`, [brandOrg]); return signup('inv@x.cl') })()
ok('NUEVA: ficha previa conserva su organización (la de la marca que la creó)', await orgOf(b3a) === brandOrg)
const tenant = (await c.query(`insert into public.organizations(name,type,influencer_tenant) values ('Contenedor X','agency',true) returning id`)).rows[0].id
const b2 = await signup('b2@x.cl')
ok('NUEVA: con organización designada, el autorregistro se asigna a ella (por la marca, no por el nombre)', await orgOf(b2) === tenant)
await c.query(`insert into public.influencers(email, display_name, organization_id) values ('inv2@x.cl','Inv2',null)`)
const b4 = await signup('inv2@x.cl')
ok('NUEVA: ficha previa sin organización recibe la designada (relación explícita)', await orgOf(b4) === tenant)
let dup = ''; try { await c.query(`insert into public.organizations(name,type,influencer_tenant) values ('Otro','agency',true)`) } catch (e) { dup = e.message }
ok('NUEVA: no puede haber dos organizaciones designadas', dup.includes('organizations_one_influencer_tenant'), dup)
let bh = ''; try { await c.query(`insert into public.brands(organization_id,name) values ($1,'Intrusa')`, [tenant]) } catch (e) { bh = e.message }
ok('NUEVA: la organización designada no puede alojar marcas', bh.includes('INFLUENCER_TENANT_CANNOT_HOST_BRANDS'), bh)
ok('NUEVA: una marca normal sigue pudiendo crearse', (await c.query(`insert into public.brands(organization_id,name) values ($1,'Normal') returning id`, [brandOrg])).rowCount === 1)
ok('NUEVA: no se crean organizaciones durante el registro', await countOrgs() === org0 + 1)
const prof = (await c.query(`select count(*) from public.influencer_social_profiles where influencer_id in (select id from public.influencers where user_id=$1)`, [b1])).rows[0].count
ok('NUEVA: sigue creando perfil social de Instagram', +prof === 1)
const nonInf = await signup('brand@x.cl', { is_influencer: false })
ok('NUEVA: usuario de marca no crea ficha de influencer', (await c.query('select count(*) from public.influencers where user_id=$1', [nonInf])).rows[0].count === '0')
ok('NUEVA: ninguna fila existente cambió de organización (ficha de b1 sigue NULL)', await orgOf(b1) === null)

// ── C. RLS ──
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222'
const orgA = (await c.query(`insert into public.organizations(name,type) values ('A','brand') returning id`)).rows[0].id
const orgB = (await c.query(`insert into public.organizations(name,type) values ('B','brand') returning id`)).rows[0].id
await c.query(`insert into public.organization_members(organization_id,user_id) values ($1,$2),($3,$4)`, [orgA, U1, orgB, U2])
await c.query('delete from public.influencer_social_profiles; delete from public.influencers')
await c.query(`insert into public.influencers(email,display_name,organization_id) values ('a@x','FichaA',$1),('b@x','FichaB',$2),('n@x','FichaNULL',null)`, [orgA, orgB])
async function as(role, sub, sql) { await c.query('begin'); await c.query(`set local role ${role}`); await c.query(`select set_config('request.jwt.sub', $1, true)`, [sub ?? '']); try { return (await c.query(sql)).rows.length ? (await c.query(sql)).rows : [] } finally { await c.query('rollback') } }
const names = async (role, sub) => (await as(role, sub, 'select display_name from public.influencers order by 1')).map(r => r.display_name).join(',')
async function upd(role, sub, name) { await c.query('begin'); await c.query(`set local role ${role}`); await c.query(`select set_config('request.jwt.sub', $1, true)`, [sub ?? '']); const r = await c.query(`update public.influencers set display_name='HACK' where display_name=$1`, [name]); await c.query('rollback'); return r.rowCount }
await c.query(ORIG_POLICY)
ok('ACTUAL RLS: anon (sin sesión) lee la ficha sin organización', (await names('anon')).includes('FichaNULL'))
ok('ACTUAL RLS: anon MODIFICA la ficha sin organización', await upd('anon', null, 'FichaNULL') === 1)
ok('ACTUAL RLS: miembro de A ve FichaA y FichaNULL', await names('authenticated', U1) === 'FichaA,FichaNULL')
await c.query('drop policy influencers_org_read on public.influencers')
await c.query(RLS)
ok('NUEVA RLS: anon no ve nada', await names('anon') === '')
ok('NUEVA RLS: anon no puede modificar la ficha sin organización', await upd('anon', null, 'FichaNULL') === 0)
ok('NUEVA RLS: miembro de A ve solo FichaA (no FichaB, no FichaNULL)', await names('authenticated', U1) === 'FichaA')
ok('NUEVA RLS: miembro de B ve solo FichaB', await names('authenticated', U2) === 'FichaB')
ok('NUEVA RLS: miembro no puede modificar fichas de otra organización ni sin organización', await upd('authenticated', U1, 'FichaB') === 0 && await upd('authenticated', U1, 'FichaNULL') === 0)
ok('NUEVA RLS: miembro conserva escritura en su propia organización (paridad)', await upd('authenticated', U1, 'FichaA') === 1)
ok('NUEVA RLS: usuario sin membresía no ve nada', await names('authenticated', '33333333-3333-3333-3333-333333333333') === '')
ok('NUEVA RLS: no se borraron ni reasignaron datos', (await c.query('select count(*) from public.influencers')).rows[0].count === '3')
// Revocación de privilegios. Producción tiene 11 políticas de OTRAS tablas con subconsulta a influencers y anon con SELECT en ellas.
await c.query(`alter table public.locations add column owner_influencer_id uuid;
 alter table public.locations enable row level security; grant select, insert on public.locations to anon, authenticated;
 create policy locations_influencer_read_own_home on public.locations for select to public using (exists (select 1 from public.influencers inf where inf.id = locations.owner_influencer_id and inf.user_id = auth.uid()));
 insert into public.locations(level, owner_influencer_id) values ('place', gen_random_uuid());`)
// (a) variante "revoke all from anon": rompe esas consultas con error en vez de vacío
await c.query('revoke all on public.influencers from anon')
let e1 = ''; try { await as('anon', null, 'select 1 from public.locations') } catch (e) { e1 = e.message }
ok('REVOKE ALL a anon: la consulta anónima a otras tablas con subconsulta a influencers FALLA (permission denied)', e1.includes('permission denied'), e1)
// (b) variante recomendada: conservar SELECT (RLS devuelve 0 filas) y quitar solo escrituras/privilegios peligrosos
await c.query('grant select on public.influencers to anon; revoke insert, update, delete, truncate, trigger, references on public.influencers from anon; revoke truncate, trigger, references on public.influencers from authenticated')
ok('REVOKE parcial: anon sigue consultando otras tablas sin error', (await as('anon', null, 'select 1 from public.locations')).length === 0)
ok('REVOKE parcial: anon ve 0 fichas', await names('anon') === '')
let e2 = ''; try { await as('anon', null, "update public.influencers set display_name='X'") } catch (e) { e2 = e.message }
ok('REVOKE parcial: anon no puede escribir', e2.includes('permission denied'), e2)
let tr = ''; try { await c.query('begin'); await c.query('set local role authenticated'); await c.query('truncate public.influencers') } catch (e) { tr = e.message } finally { await c.query('rollback') }
ok('REVOKE parcial: authenticated no puede TRUNCATE', tr.includes('permission denied'), tr)
ok('REVOKE parcial: el miembro autenticado sigue leyendo solo su organización', await names('authenticated', U1) === 'FichaA')
console.log(`\n${pass} OK, ${fail} FAIL`); await c.end(); await server.stop(); process.exit(fail ? 1 : 0)
