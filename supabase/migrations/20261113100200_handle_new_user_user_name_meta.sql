-- El alta de influencer ahora envía el nombre como user_name en los metadatos de Auth.
-- handle_new_user lo lee primero y mantiene display_name solo como respaldo para registros que ya estaban en curso.
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  IF position($q$v_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');$q$ in v_def) = 0 THEN
    RAISE EXCEPTION 'handle_new_user no tiene la línea esperada';
  END IF;
  v_def := replace(v_def,
    $q$v_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');$q$,
    $q$v_display_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'display_name')), '');$q$);
  EXECUTE v_def;
END $$;
