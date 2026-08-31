import type { SupabaseClient } from '@supabase/supabase-js'

const COMPLETED_DELIVERABLE_STATUSES = new Set(['approved', 'published'])

type CommitmentMetadata = { influencer_id?: string; campaign_id?: string; campaign_commitments?: string[] }

export type CampaignCommitmentResult = {
  blocked: boolean
  reason: 'campaign_active' | 'deliverables_pending' | null
  commitment: { campaignId: string; campaignName: string; campaignEnded: boolean; completedDeliverables: number; totalDeliverables: number } | null
}

export function subscriptionCampaignIds(metadata: unknown): string[] {
  const value = (metadata ?? {}) as CommitmentMetadata
  return Array.from(new Set([...(Array.isArray(value.campaign_commitments) ? value.campaign_commitments : []), ...(value.campaign_id ? [value.campaign_id] : [])].filter(Boolean)))
}

/** Backend source of truth for Influencer Pro cancellation eligibility. */
export async function hasActiveCampaignCommitment(admin: SupabaseClient, influencerId: string, subscriptionMetadata: unknown): Promise<CampaignCommitmentResult> {
  const campaignIds = subscriptionCampaignIds(subscriptionMetadata)
  if (campaignIds.length === 0) return { blocked: false, reason: null, commitment: null }

  const { data: relationships, error: relationshipError } = await admin.from('campaign_influencers').select('id, campaign_id, application_status').eq('influencer_id', influencerId).in('campaign_id', campaignIds)
  if (relationshipError) throw relationshipError
  const accepted = (relationships ?? []).filter(row => row.application_status === 'accepted')
  if (accepted.length === 0) return { blocked: false, reason: null, commitment: null }

  const acceptedCampaignIds = accepted.map(row => row.campaign_id)
  const [{ data: campaigns, error: campaignsError }, { data: deliverables, error: deliverablesError }] = await Promise.all([
    admin.from('campaigns').select('id, name, status').in('id', acceptedCampaignIds),
    admin.from('campaign_deliverables').select('id, campaign_id, status').eq('influencer_id', influencerId).in('campaign_id', acceptedCampaignIds),
  ])
  if (campaignsError) throw campaignsError
  if (deliverablesError) throw deliverablesError

  for (const campaign of campaigns ?? []) {
    const campaignDeliverables = (deliverables ?? []).filter(row => row.campaign_id === campaign.id)
    const completedDeliverables = campaignDeliverables.filter(row => COMPLETED_DELIVERABLE_STATUSES.has(row.status)).length
    const commitment = { campaignId: campaign.id, campaignName: campaign.name, campaignEnded: campaign.status === 'completed', completedDeliverables, totalDeliverables: campaignDeliverables.length }
    if (!commitment.campaignEnded) return { blocked: true, reason: 'campaign_active', commitment }
    if (completedDeliverables !== campaignDeliverables.length) return { blocked: true, reason: 'deliverables_pending', commitment }
  }
  return { blocked: false, reason: null, commitment: null }
}
