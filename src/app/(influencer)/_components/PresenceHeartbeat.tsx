'use client'

import { useEffect } from 'react'

// El dashboard considera "en línea" hasta 10 minutos. Cada 8 minutos deja
// margen suficiente, evita pings en segundo plano y baja ~75% las invocaciones
// frente al intervalo anterior de 2 minutos.
const HEARTBEAT_INTERVAL_MS = 8 * 60 * 1000

export function PresenceHeartbeat() {
  useEffect(() => {
    function ping() {
      if (document.visibilityState !== 'visible') return
      fetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {})
    }
    ping()
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return null
}
