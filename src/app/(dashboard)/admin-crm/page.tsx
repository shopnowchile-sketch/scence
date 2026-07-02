import type { Metadata } from 'next'
import { CrmLeadsClient } from './CrmLeadsClient'

export const metadata: Metadata = { title: 'CRM' }

export default function AdminCrmPage() {
  return <CrmLeadsClient />
}
