CREATE TABLE public.user_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_todos_user_created_idx
  ON public.user_todos (user_id, created_at DESC);

ALTER TABLE public.user_todos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_todos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_todos TO authenticated;

CREATE POLICY "user_todos_select_own"
  ON public.user_todos
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "user_todos_insert_own"
  ON public.user_todos
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "user_todos_update_own"
  ON public.user_todos
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "user_todos_delete_own"
  ON public.user_todos
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);
