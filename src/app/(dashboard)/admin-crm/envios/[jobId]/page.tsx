import type { Metadata } from 'next'
import { JobDetailClient } from './JobDetailClient'

export const metadata: Metadata = { title: 'CRM — Envío masivo' }

export default function AdminCrmEnvioPage({ params }: { params: { jobId: string } }) {
  return <JobDetailClient jobId={params.jobId} />
}
