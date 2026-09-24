// Hook de resolución SOLO para tests: permite que `node --test` cargue módulos
// de src/ que importan otros módulos locales sin extensión ('./brand-plans'),
// tal como los resuelve Next. No afecta el build ni el runtime de la app.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (isRelative && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
  }
  return nextResolve(specifier, context)
}
