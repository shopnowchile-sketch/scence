import { createBrowserClient as _createBrowserClient } from '@supabase/ssr'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/** Standard export — hooks, components */
export function createClient() {
  return _createBrowserClient(URL, KEY)
}

/** Alias for LoginForm / RegisterForm that import this name */
export function createBrowserClient() {
  return _createBrowserClient(URL, KEY)
}
