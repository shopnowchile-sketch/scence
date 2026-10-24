import { createBrowserClient as _createBrowserClient } from '@supabase/ssr'
import { browserDatabaseBlock, NonProductionSafetyError } from '@/lib/runtime-env'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// NEXT_PUBLIC_APP_ENV se fija en la compilación (next.config.mjs). En una
// compilación de producción vale 'production' y esta barrera nunca actúa.
function guardedBrowserClient() {
  const block = browserDatabaseBlock({ url: URL, anonKey: KEY, appEnv: process.env.NEXT_PUBLIC_APP_ENV })
  if (block) throw new NonProductionSafetyError(block)
  return _createBrowserClient(URL, KEY)
}

/** Standard export — hooks, components */
export function createClient() {
  return guardedBrowserClient()
}

/** Alias for LoginForm / RegisterForm that import this name */
export function createBrowserClient() {
  return guardedBrowserClient()
}
