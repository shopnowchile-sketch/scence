/**
 * Bookings Page
 * - Vista mensual/semanal de bookings (calendar grid)
 * - Integración con Google Calendar (cada booking crea un evento)
 * - Mapa de la ubicación en el detalle del booking
 */

import type { Metadata } from 'next'
import { BookingsClient } from './BookingsClient'

export const metadata: Metadata = { title: 'Bookings' }

export default function BookingsPage() {
  return <BookingsClient />
}
