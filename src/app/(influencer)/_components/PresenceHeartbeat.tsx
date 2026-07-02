'use client'

import { useEffect } from 'react'

// Manda un heartbeat al montar y cada 2 minutos mientras el portal influencer
// está abierto en esta pestaña. El umbral de "en línea" en el dashboard admin
// (DashboardClient.tsx) es 10 minutos, así que 2 minutos de por medio deja
// margen de sobra. No bloquea el render — falla en silencio si no hay red.
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000

export function PresenceHeartbeat() {
  useEffect(() => {
    function ping() {
      fetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {})
    }
    ping()
    const id = setInterval(ping, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return null
}
