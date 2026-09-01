import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'

type Movement = {
  id: string
  points: number
  label: string
  campaign: string
  date: string
}

type DeliverableRow = {
  id: string
  type: string | null
  status: string | null
  due_date: string | null
  content_url: string | null
  published_url: string | null
  submitted_at: string | null
  published_at: string | null
  attendance_response: string | null
  attendance_responded_at: string | null
  attendance_outcome: string | null
  attendance_outcome_at: string | null
}

type MembershipRow = {
  id: string
  origin: string | null
  application_status: string | null
  created_at: string
  updated_at: string | null
  campaign: { id: string; name: string; status: string; end_date: string | null } | null
  campaign_deliverables: DeliverableRow[] | null
}

const SUBMITTED_STATUSES = new Set(['in_review', 'approved', 'completed', 'published'])

function isSubmitted(deliverable: DeliverableRow) {
  return Boolean(
    deliverable.submitted_at ||
    deliverable.content_url ||
    deliverable.published_url ||
    SUBMITTED_STATUSES.has(deliverable.status ?? '')
  )
}

export async function GET() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: influencer } = await admin
    .from('influencers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!influencer) return NextResponse.json({ error: 'Not an influencer account' }, { status: 403 })

  const { data, error } = await admin
    .from('campaign_influencers')
    .select(`
      id, origin, application_status, created_at, updated_at,
      campaign:campaigns (id, name, status, end_date),
      campaign_deliverables (
        id, type, status, due_date, content_url, published_url, submitted_at, published_at,
        attendance_response, attendance_responded_at, attendance_outcome, attendance_outcome_at
      )
    `)
    .eq('influencer_id', influencer.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/influencer/points]', error)
    return NextResponse.json({ error: 'No se pudo calcular tu SCENCE Score.' }, { status: 500 })
  }

  const memberships = (data ?? []) as unknown as MembershipRow[]
  const movements = new Map<string, Movement>()
  const add = (movement: Movement) => movements.set(movement.id, movement)
  const now = Date.now()
  let completedCampaigns = 0
  let onTimeCampaigns = 0
  let attendances = 0
  let cancellations = 0
  const breachCampaigns = new Set<string>()

  for (const membership of memberships) {
    const campaign = membership.campaign
    if (!campaign) continue
    const campaignName = campaign.name || 'Campaña'
    const isCanceled = campaign.status === 'canceled'
    const isAccepted = membership.application_status === 'accepted'
    const deliverables = membership.campaign_deliverables ?? []

    if (membership.origin === 'application') {
      add({ id: `application:${membership.id}`, points: 1, label: 'Postuló a una campaña', campaign: campaignName, date: membership.created_at })
    }

    if (campaign.status === 'completed' && isAccepted) completedCampaigns += 1

    const contentDeliverables = deliverables.filter(deliverable => deliverable.type !== 'event_attendance')
    const submittedContent = contentDeliverables.filter(isSubmitted)
    const allContentSubmitted = contentDeliverables.length > 0 && submittedContent.length === contentDeliverables.length
    const allContentOnTime = allContentSubmitted && contentDeliverables.every(deliverable => {
      if (!deliverable.due_date || !deliverable.submitted_at) return false
      return new Date(deliverable.submitted_at).getTime() <= new Date(deliverable.due_date).getTime()
    })

    if (campaign.status === 'completed' && isAccepted && allContentOnTime) onTimeCampaigns += 1

    for (const deliverable of deliverables) {
      if (deliverable.type === 'event_attendance') {
        const respondedAt = deliverable.attendance_responded_at
        const confirmedOnTime = deliverable.attendance_response === 'confirmed' && respondedAt && (
          !deliverable.due_date || new Date(respondedAt).getTime() <= new Date(deliverable.due_date).getTime()
        )

        if (confirmedOnTime) {
          add({ id: `attendance-confirmed:${deliverable.id}`, points: 10, label: 'Confirmó asistencia a tiempo', campaign: campaignName, date: respondedAt })
        }

        if (deliverable.attendance_response === 'declined') cancellations += 1

        if (deliverable.attendance_outcome === 'attended') {
          attendances += 1
          const outcomeDate = deliverable.attendance_outcome_at ?? campaign.end_date ?? membership.updated_at ?? membership.created_at
          add({ id: `attendance-attended:${deliverable.id}`, points: 10, label: 'Asistió al evento', campaign: campaignName, date: outcomeDate })
          if (deliverable.attendance_response === 'confirmed') {
            add({ id: `attendance-confirmed-attended:${deliverable.id}`, points: 10, label: 'Confirmó y asistió', campaign: campaignName, date: outcomeDate })
          } else if (!isCanceled) {
            add({ id: `attendance-unconfirmed-attended:${deliverable.id}`, points: -5, label: 'No confirmó, pero asistió', campaign: campaignName, date: outcomeDate })
            breachCampaigns.add(campaign.id)
          }
        } else if (deliverable.attendance_outcome === 'no_show' && !isCanceled) {
          const outcomeDate = deliverable.attendance_outcome_at ?? campaign.end_date ?? membership.updated_at ?? membership.created_at
          const confirmed = deliverable.attendance_response === 'confirmed'
          add({
            id: `attendance-no-show:${deliverable.id}`,
            points: confirmed ? -40 : -50,
            label: confirmed ? 'Confirmó y no asistió' : 'No confirmó y no asistió',
            campaign: campaignName,
            date: outcomeDate,
          })
          breachCampaigns.add(campaign.id)
        } else if (
          !isCanceled &&
          !deliverable.attendance_response &&
          deliverable.due_date &&
          new Date(deliverable.due_date).getTime() < now
        ) {
          add({ id: `attendance-unconfirmed:${deliverable.id}`, points: -5, label: 'No confirmó asistencia', campaign: campaignName, date: deliverable.due_date })
          breachCampaigns.add(campaign.id)
        }
        continue
      }

      const submitted = isSubmitted(deliverable)
      const submissionDate = deliverable.submitted_at ?? deliverable.published_at
      if (submitted && submissionDate && deliverable.due_date) {
        const onTime = new Date(submissionDate).getTime() <= new Date(deliverable.due_date).getTime()
        if (onTime) {
          add({ id: `delivery-on-time:${deliverable.id}`, points: 30, label: 'Entregó contenido a tiempo', campaign: campaignName, date: submissionDate })
        } else if (!isCanceled) {
          add({ id: `delivery-late:${deliverable.id}`, points: -20, label: 'Entregó contenido tarde', campaign: campaignName, date: submissionDate })
          breachCampaigns.add(campaign.id)
        }
      } else if (
        !submitted &&
        !isCanceled &&
        campaign.status === 'completed' &&
        deliverable.due_date &&
        new Date(deliverable.due_date).getTime() < now
      ) {
        add({ id: `delivery-missing:${deliverable.id}`, points: -60, label: 'No entregó contenido', campaign: campaignName, date: deliverable.due_date })
        breachCampaigns.add(campaign.id)
      }

      if (deliverable.type === 'story' && submitted) {
        add({
          id: `story-published:${deliverable.id}`,
          points: 5,
          label: 'Publicó Story requerido',
          campaign: campaignName,
          date: submissionDate ?? membership.updated_at ?? membership.created_at,
        })
      }
    }

    if (allContentSubmitted) {
      const completionDate = submittedContent
        .map(deliverable => deliverable.submitted_at ?? deliverable.published_at)
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1) ?? membership.updated_at ?? membership.created_at
      add({ id: `campaign-deliverables-complete:${membership.id}`, points: 20, label: 'Completó todos los entregables', campaign: campaignName, date: completionDate })
    }
  }

  const sortedMovements = Array.from(movements.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return NextResponse.json({
    data: {
      score: sortedMovements.reduce((total, movement) => total + movement.points, 0),
      activity: {
        completed_campaigns: completedCampaigns,
        on_time_campaigns: onTimeCampaigns,
        attendances,
        cancellations,
        breaches: breachCampaigns.size,
      },
      movements: sortedMovements.slice(0, 20),
      unavailable_rules: ['Cancelar avisando con anticipación', 'Cancelar con poco tiempo'],
    },
  })
}
