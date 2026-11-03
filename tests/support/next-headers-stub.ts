// Sustituto de 'next/headers' SOLO para pruebas de rutas: las cookies salen de globalThis.__routeHarness.cookies.
export function cookies() {
  const jar = ((globalThis as { __routeHarness?: { cookies?: Record<string, string> } }).__routeHarness?.cookies) ?? {}
  return { get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined) }
}
