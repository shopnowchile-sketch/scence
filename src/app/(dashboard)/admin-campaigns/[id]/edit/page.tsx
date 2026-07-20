import { redirect } from 'next/navigation'

export default function EditCampaignPage({ params }: { params: { id: string } }) {
  redirect(`/admin-campaigns/${params.id}?tab=overview&mode=edit`)
}
