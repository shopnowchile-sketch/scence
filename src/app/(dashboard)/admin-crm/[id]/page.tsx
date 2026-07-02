import type { Metadata } from 'next'
import { CrmLeadDetailClient } from './CrmLeadDetailClient'

export const metadata: Metadata = { title: 'Lead CRM' }

export default function AdminCrmLeadPage({ params }: { params: { id: string } }) {
  return <CrmLeadDetailClient id={params.id} />
}
