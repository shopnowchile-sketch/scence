// Selección segura del destino de PayPal para los scripts de operación.
//
// Reglas (se prueban en tests/nonprod-safety-scripts.test.ts):
//  1. Sandbox por defecto, SIEMPRE: PAYPAL_ENV=live en un archivo de entorno NO basta.
//  2. Live exige, a la vez: --live, --confirm-live=<frase> y PAYPAL_ENV=live en el
//     archivo de entorno (coherencia con las credenciales). Falta una y se aborta.
//  3. Live se rechaza si el proceso corre en un entorno de pruebas
//     (VERCEL_ENV preview/development, NODE_ENV development/test, CI).
//  4. Dry-run por defecto: las operaciones que escriben exigen --apply.
//  5. Con --apply sobre una base Supabase de producción también se exige Live confirmado.
//  6. Nunca se imprimen secretos: solo host, modo y ref del proyecto.

export const PAYPAL_LIVE_BASE_URL = 'https://api-m.paypal.com'
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com'
export const LIVE_CONFIRMATION = 'USAR-PAYPAL-REAL'
export const PRODUCTION_SUPABASE_PROJECT_REF = 'xzzbishzfyovrladcaeb'

export function isTestEnvironment(env) {
  return ['preview', 'development'].includes(env.VERCEL_ENV)
    || ['development', 'test'].includes(env.NODE_ENV)
    || Boolean(env.CI)
}

function supabaseRef(url) {
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.')
    return labels.length >= 3 && labels.slice(-2).join('.') === 'supabase.co' ? labels[labels.length - 3] : null
  } catch { return null }
}

export function resolvePayPalTarget({ argv = [], env = {}, processEnv = {}, writesSupabase = false } = {}) {
  const flag = (name) => argv.includes(`--${name}`)
  const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const apply = flag('apply')
  const wantLive = flag('live')
  const notes = []

  let mode = 'sandbox'
  if (wantLive) {
    if (value('confirm-live') !== LIVE_CONFIRMATION) {
      throw new Error(`PayPal Live requiere --live y --confirm-live=${LIVE_CONFIRMATION}. No se hizo ninguna llamada.`)
    }
    if (env.PAYPAL_ENV !== 'live') {
      throw new Error('--live exige PAYPAL_ENV=live en el archivo de entorno (credenciales coherentes). No se hizo ninguna llamada.')
    }
    if (isTestEnvironment(processEnv)) {
      throw new Error('PayPal Live no puede ejecutarse desde un entorno de pruebas (VERCEL_ENV/NODE_ENV/CI). No se hizo ninguna llamada.')
    }
    mode = 'live'
  } else if (env.PAYPAL_ENV === 'live') {
    notes.push('PAYPAL_ENV=live del archivo de entorno IGNORADO: se usa Sandbox. Para Live use --live --confirm-live=' + LIVE_CONFIRMATION + '.')
  }

  const ref = supabaseRef(env.NEXT_PUBLIC_SUPABASE_URL)
  if (writesSupabase && apply && ref === PRODUCTION_SUPABASE_PROJECT_REF && mode !== 'live') {
    throw new Error('--apply sobre la base de datos de producción exige además --live --confirm-live=' + LIVE_CONFIRMATION + '. No se escribió nada.')
  }

  return {
    mode,
    base: mode === 'live' ? PAYPAL_LIVE_BASE_URL : PAYPAL_SANDBOX_BASE_URL,
    apply,
    dryRun: !apply,
    supabaseRef: ref,
    notes,
  }
}
