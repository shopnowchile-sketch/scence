import { redirect } from 'next/navigation'

export default function EditBrandCampaignPage({ params }: { params: { id: string } }) {
  redirect(`/brand-campaigns/${params.id}?tab=overview&mode=edit`)
}
