// Única fuente del servidor de PayPal. Ningún otro archivo de src/ nombra el host
// de Live (lo verifica tests/nonprod-safety-static.test.ts).
//
// Reglas:
//  - PayPal Live solo es posible en producción (isProductionRuntime) Y con
//    PAYPAL_ENV === 'live' (igual que antes).
//  - Fuera de producción, PAYPAL_ENV=live es una configuración insegura: se
//    falla de forma explícita, sin llegar a hacer ninguna llamada.
//  - Cualquier otro valor usa Sandbox, como hasta ahora.
// Las credenciales no pueden saltarse esto: el host decide, y las credenciales
// de Sandbox no operan en Live ni al revés.
import { isProductionRuntime, type RuntimeEnv } from './runtime-env'

export type PayPalMode = 'live' | 'sandbox'

export const PAYPAL_LIVE_BASE_URL = 'https://api-m.paypal.com'
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com'

export class PayPalEnvironmentError extends Error {
  readonly code = 'PAYPAL_UNSAFE_ENVIRONMENT'
  constructor(message: string) {
    super(message)
    this.name = 'PayPalEnvironmentError'
  }
}

export function resolvePayPalMode(env?: RuntimeEnv): PayPalMode {
  const source: RuntimeEnv = env ?? {
    PAYPAL_ENV: process.env.PAYPAL_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  }
  if (source.PAYPAL_ENV !== 'live') return 'sandbox'
  if (!isProductionRuntime(source)) {
    throw new PayPalEnvironmentError(
      'Configuración insegura: PAYPAL_ENV=live fuera de producción. PayPal Live solo se permite en producción; use Sandbox.',
    )
  }
  return 'live'
}

export function payPalBaseUrl(env?: RuntimeEnv): string {
  return resolvePayPalMode(env) === 'live' ? PAYPAL_LIVE_BASE_URL : PAYPAL_SANDBOX_BASE_URL
}
