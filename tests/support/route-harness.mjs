// Hook de resolución SOLO para pruebas de rutas de API (se registra encima de ts-resolve.mjs).
//  - '@/lib/supabase/server'  → tests/support/supabase-server-stub.ts (base en memoria, sin red)
//  - 'next/server'            → 'next/server.js' (Node ESM no resuelve el directorio sin extensión)
// No toca src/, el build ni el runtime de la app, y solo vive dentro del proceso de ese test.
const STUB = new URL('./supabase-server-stub.ts', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/supabase/server') return nextResolve(STUB, context)
  if (specifier === 'next/server') return nextResolve('next/server.js', context)
  return nextResolve(specifier, context)
}
