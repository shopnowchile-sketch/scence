// Cliente de Resend "sumidero" para entornos no productivos: no hace ninguna
// llamada de red ni envía nada. Responde como un envío exitoso para que los
// flujos se puedan probar de punta a punta, y deja constancia en el log sin
// destinatarios ni contenido. Cualquier otro método de Resend falla cerrado.
import type { Resend } from 'resend'
import { NonProductionSafetyError } from './runtime-env'

type LogFn = (message: string) => void

export function createBlockedResend(log: LogFn = message => console.warn(message)): Resend {
  let counter = 0
  const nextId = () => `blocked-non-production-${Date.now()}-${++counter}`

  const emails = {
    send: async (_payload?: unknown, _options?: unknown) => {
      log('[resend:bloqueado] 1 correo NO enviado: entorno no productivo')
      return { data: { id: nextId() }, error: null }
    },
  }
  const batch = {
    send: async (payloads?: unknown[], _options?: unknown) => {
      const list = Array.isArray(payloads) ? payloads : []
      log(`[resend:bloqueado] ${list.length} correo(s) NO enviado(s): entorno no productivo`)
      return { data: { data: list.map(() => ({ id: nextId() })) }, error: null }
    },
  }
  const known: Record<string, unknown> = { emails, batch }

  return new Proxy(known, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop]
      if (typeof prop === 'symbol' || prop === 'then') return undefined
      throw new NonProductionSafetyError(`Resend.${prop} no está disponible fuera de producción.`)
    },
  }) as unknown as Resend
}
