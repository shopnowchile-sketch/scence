// Sustituto de '@/lib/supabase/server' SOLO para pruebas de rutas (ver route-harness.mjs).
// Sin red, sin cookies, sin credenciales: devuelve la sesión y la base en memoria que
// el test dejó en globalThis.__routeHarness.

type Harness = { user: { id: string } | null; admin: unknown }

function harness(): Harness {
  const h = (globalThis as { __routeHarness?: Harness }).__routeHarness
  if (!h) throw new Error('route harness no inicializado: el test debe fijar globalThis.__routeHarness')
  return h
}

export function createServerClient() {
  return { auth: { getUser: async () => ({ data: { user: harness().user } }) } }
}

export function createAdminClient() {
  return harness().admin
}
