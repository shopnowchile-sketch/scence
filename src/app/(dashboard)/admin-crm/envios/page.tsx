import type { Metadata } from 'next'
import { EnviosClient } from './EnviosClient'

export const metadata: Metadata = { title: 'CRM — Envíos masivos' }

export default function AdminCrmEnviosPage() {
  return <EnviosClient />
}
