import { SupportPage } from '@/components/support/SupportPage'

export const dynamic = 'force-dynamic'

export default function AdminSupportPage() {
  return <SupportPage adminMode={true} />
}
