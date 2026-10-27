-- PROPUESTA v2 — NO EJECUTADA. Solo para la rama de pruebas dexpvoubiklgotuukrml (NUNCA producción).
-- Archiva (no borra) las 3 marcas de prueba `p4conc` y desactiva sus 3 organizaciones.
--
-- Los seis IDs exactos (los únicos que el script puede tocar):
--   Marca  afa991d0-cd3d-47dc-878d-aae564730ebc → Org 29478253-af51-4152-80ff-135e4212cf24  (p4conc Uno)
--   Marca  b1d13e82-b367-4039-b5d2-8d24c8d9e2cd → Org fc1facbf-fe4b-4d83-88a0-34677021f4da  (p4conc Dos)
--   Marca  168087b7-5e08-4fd7-be35-f9012e2bb99f → Org 7a654f81-1037-4afe-9dfb-b8a585149ce9  (p4conc Tres)
--
-- Garantías (todas dentro de UNA transacción; cualquier fallo la revierte completa):
--   1. Precondiciones: exactamente 3 marcas que coinciden en id + nombre + estado + creador +
--      user_id nulo + clave de registro; los 3 pares marca→organización exactos; cada organización
--      con 1 sola marca; slugs p4conc-*.
--   2. Cero dependencias: recorre TODAS las claves foráneas que apuntan a brands y organizations
--      (excepto brands.organization_id) y exige 0 filas para estos IDs.
--   3. Huella del resto: md5 de todas las demás marcas y organizaciones antes y después; deben ser
--      idénticas, y los totales también.
--   4. Exactamente 3 y 3 filas actualizadas; si no, aborta.
-- Efectos secundarios conocidos: organizations tiene trg_updated_at (solo toca updated_at de esas
-- 3 filas). brands no tiene disparadores sobre status/metadata.

begin;
set local lock_timeout = '5s';
do $$
declare
  b_ids uuid[] := array['afa991d0-cd3d-47dc-878d-aae564730ebc','b1d13e82-b367-4039-b5d2-8d24c8d9e2cd','168087b7-5e08-4fd7-be35-f9012e2bb99f']::uuid[];
  o_ids uuid[] := array['29478253-af51-4152-80ff-135e4212cf24','fc1facbf-fe4b-4d83-88a0-34677021f4da','7a654f81-1037-4afe-9dfb-b8a585149ce9']::uuid[];
  creator constant uuid := '8190c816-aebf-41cb-8414-aec348797a67';
  n int; r record; h_b_before text; h_b_after text; h_o_before text; h_o_after text;
  tot_b int; tot_o int; tot_b2 int; tot_o2 int; nb int; no_ int;
begin
  -- 1) precondiciones
  select count(*) into n from public.brands
   where id = any(b_ids) and name like 'p4conc %' and status = 'pending_approval'
     and created_by = creator and user_id is null and metadata->>'registration_key' like 'p4conc-%';
  if n <> 3 then raise exception 'precondición: se esperaban 3 marcas p4conc y hay %', n; end if;

  select count(*) into n from public.brands
   where (id, organization_id) in ((b_ids[1], o_ids[1]), (b_ids[2], o_ids[2]), (b_ids[3], o_ids[3]));
  if n <> 3 then raise exception 'precondición: los pares marca→organización no coinciden (%)', n; end if;

  select count(*) into n from public.organizations where id = any(o_ids) and slug like 'p4conc-%' and is_active;
  if n <> 3 then raise exception 'precondición: se esperaban 3 organizaciones p4conc activas y hay %', n; end if;

  select count(*) into n from public.brands where organization_id = any(o_ids) and id <> all(b_ids);
  if n <> 0 then raise exception 'precondición: hay % marcas ajenas dentro de esas organizaciones', n; end if;

  -- 2) cero dependencias en cualquier tabla que referencie brands u organizations
  for r in
    select c.conrelid::regclass::text tabla, a.attname col, c.confrelid
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid in ('public.brands'::regclass, 'public.organizations'::regclass)
       and not (c.conrelid = 'public.brands'::regclass and a.attname = 'organization_id')
  loop
    execute format('select count(*) from %s where %I = any($1)', r.tabla, r.col)
      into n using (case when r.confrelid = 'public.brands'::regclass then b_ids else o_ids end);
    if n <> 0 then raise exception 'dependencia: % filas en %.%', n, r.tabla, r.col; end if;
  end loop;

  -- 3) huella del resto, antes
  select count(*), md5(string_agg(to_jsonb(b)::text, '|' order by b.id)) into tot_b, h_b_before from public.brands b where id <> all(b_ids);
  select count(*), md5(string_agg(to_jsonb(o)::text, '|' order by o.id)) into tot_o, h_o_before from public.organizations o where id <> all(o_ids);

  -- 4) archivar (no borrar)
  update public.brands
     set status = 'rejected',
         metadata = metadata || '{"test_row": true, "archived_by": "p4conc cleanup 2026-10-22"}'::jsonb
   where id = any(b_ids);
  get diagnostics nb = row_count;
  update public.organizations set is_active = false where id = any(o_ids);
  get diagnostics no_ = row_count;
  if nb <> 3 or no_ <> 3 then raise exception 'archivado abortado: marcas=%, organizaciones=%', nb, no_; end if;

  -- 5) el resto debe quedar idéntico
  select count(*), md5(string_agg(to_jsonb(b)::text, '|' order by b.id)) into tot_b2, h_b_after from public.brands b where id <> all(b_ids);
  select count(*), md5(string_agg(to_jsonb(o)::text, '|' order by o.id)) into tot_o2, h_o_after from public.organizations o where id <> all(o_ids);
  if tot_b <> tot_b2 or tot_o <> tot_o2 or h_b_before is distinct from h_b_after or h_o_before is distinct from h_o_after then
    raise exception 'archivado abortado: el resto de marcas/organizaciones cambió';
  end if;
  raise notice 'OK: 3 marcas y 3 organizaciones archivadas; resto intacto (% marcas, % organizaciones)', tot_b2, tot_o2;
end $$;
commit;

-- ─────────────────────────── REVERSIÓN (misma garantía) ───────────────────────────
-- begin;
-- do $$ declare nb int; no_ int;
-- begin
--   update public.brands set status = 'pending_approval', metadata = metadata - 'test_row' - 'archived_by'
--    where id in ('afa991d0-cd3d-47dc-878d-aae564730ebc','b1d13e82-b367-4039-b5d2-8d24c8d9e2cd','168087b7-5e08-4fd7-be35-f9012e2bb99f')
--      and status = 'rejected' and metadata->>'archived_by' = 'p4conc cleanup 2026-10-22';
--   get diagnostics nb = row_count;
--   update public.organizations set is_active = true
--    where id in ('29478253-af51-4152-80ff-135e4212cf24','fc1facbf-fe4b-4d83-88a0-34677021f4da','7a654f81-1037-4afe-9dfb-b8a585149ce9')
--      and slug like 'p4conc-%' and not is_active;
--   get diagnostics no_ = row_count;
--   if nb <> 3 or no_ <> 3 then raise exception 'reversión abortada: % / %', nb, no_; end if;
-- end $$;
-- commit;
-- Nota: organizations.updated_at queda con la hora de la reversión (trigger); es el único residuo.
