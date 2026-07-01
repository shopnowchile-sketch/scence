// ── ENUMS ────────────────────────────────────────────────
export type UserRole = 'super_admin' | 'agency_manager' | 'brand_manager' | 'influencer' | 'finance'
export type CampaignStatus = 'draft' | 'pending_approval' | 'active' | 'paused' | 'completed' | 'canceled'
export type CampaignType = 'sponsored_post' | 'event_appearance' | 'ambassador' | 'product_seeding' | 'ugc' | 'live'
export type BookingStatus = 'proposed' | 'confirmed' | 'completed' | 'canceled' | 'no_show'
export type DeliverableType = 'instagram_post' | 'instagram_story' | 'instagram_reel' | 'tiktok' | 'youtube' | 'youtube_short' | 'blog' | 'podcast' | 'event_appearance' | 'live_stream' | 'ugc_video' | 'ugc_photo'
export type DeliverableStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'published'
export type SocialPlatform = 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'facebook' | 'linkedin' | 'pinterest' | 'twitch' | 'snapchat'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void' | 'partially_paid'
export type PayrollStatus = 'pending' | 'approved' | 'processing' | 'paid' | 'failed'
export type Currency = 'USD' | 'EUR' | 'MXN' | 'CLP' | 'COP' | 'ARS' | 'BRL' | 'GBP'

// ── INFLUENCER ─────────────────────────────────────────
export interface SocialProfile {
  id: string
  influencer_id?: string        // present when fetched from DB join
  platform: SocialPlatform
  username: string | null
  profile_url: string | null
  followers: number
  followers_count?: number      // alias — some queries return this name
  following: number | null
  following_count?: number
  engagement_rate: number | null
  avg_likes: number | null
  avg_comments: number | null
  avg_views: number | null
  is_primary: boolean
  verified: boolean | null
  last_synced_at: string | null
}

export interface RateCard {
  id: string
  influencer_id?: string        // present when fetched from DB join
  deliverable_type: DeliverableType
  service_type?: string         // alias usado en algunos UI components
  base_rate: number
  currency: Currency
  includes_usage_rights: boolean
  usage_rights_duration_days: number | null
  notes: string | null
  is_active: boolean
}

export interface Influencer {
  id: string
  user_id: string | null
  organization_id: string | null
  display_name: string
  bio: string | null
  avatar_url: string | null
  cover_url: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  country: string | null
  city: string | null
  commune: string | null
  address: string | null          // dirección completa para Google Maps
  address_lat: number | null      // coordenadas guardadas
  address_lng: number | null
  timezone: string | null
  language: string[] | null
  categories: string[] | null
  tags: string[] | null
  gender: string | null
  age_range: string | null
  audience_age_range: string | null
  audience_gender_split: { female: number; male: number } | null
  audience_countries: Record<string, number> | null
  is_verified: boolean
  is_active: boolean
  rating: number | null
  notes: string | null
  metadata: Record<string, unknown> | null
  social_profiles: SocialProfile[]
  rate_cards: RateCard[]
  created_at: string
  updated_at: string
  last_sign_in_at?: string | null   // enriquecido desde auth.users
}

// Influencer con datos de campañas y deliverables (respuesta de GET /api/influencers/[id])
export interface CampaignInfluencerJoin {
  id: string
  fee: number | null
  status: string | null
  campaign: {
    id: string
    name: string
    status: string
    start_date: string | null
    end_date: string | null
    type: string | null
    platforms: string[] | null
  } | null
}

export interface DeliverableJoin {
  id: string
  title: string
  type: string | null
  status: string
  due_date: string | null
  platform: string | null
  published_at: string | null
  campaign: { id: string; name: string } | null
}

export interface InfluencerDetail extends Influencer {
  campaign_influencers: CampaignInfluencerJoin[]
  campaign_deliverables: DeliverableJoin[]
}

// ── CAMPAIGN DETAIL (respuesta de GET /api/campaigns/[id]) ────────────────────
export interface CampaignInfluencerDetail {
  id: string
  fee: number | null
  currency?: string | null
  status: string | null
  notes: string | null
  influencer: {
    id: string
    display_name: string
    avatar_url: string | null
    city: string | null
  commune: string | null
    country: string | null
    influencer_social_profiles: Array<{
      platform: string
      username: string | null
      followers: number
      engagement_rate: number | null
    }>
  } | null
}

export interface CampaignDeliverableDetail {
  id: string
  title: string
  type: string | null
  status: DeliverableStatus
  due_date: string | null
  platform: string | null
  published_at: string | null
  published_url: string | null
  content_url: string | null     // URL del contenido entregado por el influencer
  submitted_at: string | null    // Fecha en que el influencer entregó el contenido
  review_notes: string | null
  progress: number | null
  influencer: {
    id: string
    display_name: string
    avatar_url: string | null
  } | null
}

export interface CampaignDetail extends Campaign {
  campaign_influencers: CampaignInfluencerDetail[]
  campaign_deliverables: CampaignDeliverableDetail[]
  social_tags: string[] | null
  deliverable_templates: Array<{ type: string; quantity: number; description?: string; due_date?: string }> | null
  commission_rate: number | null
}

// computed helpers
export type InfluencerTier = 'nano' | 'micro' | 'macro' | 'mega'
export function getInfluencerTier(followers: number): InfluencerTier {
  if (followers < 10_000) return 'nano'
  if (followers < 100_000) return 'micro'
  if (followers < 1_000_000) return 'macro'
  return 'mega'
}

export function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

// ── CAMPAIGN ───────────────────────────────────────────
export interface Campaign {
  id: string
  organization_id: string
  created_by: string
  name: string
  description: string | null
  brief_url: string | null
  type: CampaignType
  status: CampaignStatus
  start_date: string | null
  end_date: string | null
  budget_total: number | null
  budget_spent: number
  currency: Currency
  goals: Record<string, number>
  hashtags: string[]
  platforms: SocialPlatform[]
  content_guidelines: string | null
  approval_required: boolean
  tags: string[]
  influencer_count?: number
  deliverable_count?: number
  deliverable_done?: number
  brand_id?: string | null
  commission_rate?: number | null
  brand?: { id: string; name: string; logo_url: string | null } | null
  social_tags?: string[] | null
  deliverable_templates?: Array<{ type: string; quantity: number; description?: string; due_date?: string }> | null
  created_at: string
  updated_at: string
}

// ── BOOKING ────────────────────────────────────────────
export interface Booking {
  id: string
  campaign_id: string | null
  organization_id: string
  influencer_id: string
  created_by: string
  title: string
  description: string | null
  status: BookingStatus
  event_type: string | null
  location: string | null
  location_lat: number | null     // para Google Maps
  location_lng: number | null
  location_place_id: string | null // Google Places ID
  is_virtual: boolean
  virtual_link: string | null
  starts_at: string
  ends_at: string
  confirmed_at: string | null
  canceled_at: string | null
  fee: number | null
  currency: Currency
  travel_covered: boolean
  travel_budget: number | null
  notes: string | null
  calendar_event_id: string | null         // DB column name (not google_calendar_event_id)
  metadata: Record<string, unknown> | null // stores google_calendar_link etc.
  // Computed helpers from metadata
  google_calendar_link?: string | null
  influencer?: Pick<Influencer, 'id' | 'display_name' | 'avatar_url'>
  campaign?: Pick<Campaign, 'id' | 'name'>
  booking_influencers?: Array<{
    id: string
    influencer_id: string
    status: string
    influencer?: Pick<Influencer, 'id' | 'display_name' | 'avatar_url'> | null
  }>
  created_at: string
  updated_at: string
}

// ── INVOICE ────────────────────────────────────────────
export interface Invoice {
  id: string
  invoice_number: string
  organization_id: string
  campaign_id: string | null
  status: InvoiceStatus
  subtotal: number
  tax_rate: number
  tax_amount: number
  discount_amount: number
  total: number
  currency: Currency
  issue_date: string
  due_date: string
  paid_at: string | null
  notes: string | null
  pdf_url: string | null
  created_at: string
}

// ── FILTERS ───────────────────────────────────────────
export interface CampaignFilters {
  search: string
  status: CampaignStatus | ''
  type: CampaignType | ''
  platform: SocialPlatform | ''
  dateFrom: string
  dateTo: string
}

export const DEFAULT_CAMPAIGN_FILTERS: CampaignFilters = {
  search: '', status: '', type: '', platform: '', dateFrom: '', dateTo: '',
}

export interface InfluencerFilters {
  search: string
  platforms: SocialPlatform[]
  categories: string[]
  tier: InfluencerTier | ''
  country: string
  minFollowers: number
  maxFollowers: number
  minEngagement: number
  isVerified: boolean | null
  isActive: boolean | null
  statusFilter: 'all' | 'active' | 'draft' | 'inactive'
  sortBy: 'followers' | 'engagement_rate' | 'rating' | 'display_name' | 'created_at'
  sortOrder: 'asc' | 'desc'
}

export const DEFAULT_INFLUENCER_FILTERS: InfluencerFilters = {
  search: '',
  platforms: [],
  categories: [],
  tier: '',
  country: '',
  minFollowers: 0,
  maxFollowers: 10_000_000,
  minEngagement: 0,
  isVerified: null,
  isActive: true,
  statusFilter: 'all',
  sortBy: 'created_at',
  sortOrder: 'desc',
}

// ── GOOGLE CALENDAR ────────────────────────────────────
export interface GoogleCalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  attendees?: { email: string; displayName?: string; responseStatus?: string }[]
  htmlLink?: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  colorId?: string
}

export interface CreateCalendarEventInput {
  title: string
  description?: string
  location?: string
  startsAt: Date
  endsAt: Date
  attendeeEmails?: string[]
  timeZone?: string
}

// ── BARTERS (canjes) ───────────────────────────────────
export type BarterStatus =
  | 'pactado'
  | 'pendiente_envio'
  | 'enviado'
  | 'recibido'
  | 'contenido_pendiente'
  | 'contenido_publicado'
  | 'cerrado'
  | 'con_problema'

/** Flujo lineal del canje. `con_problema` es un estado lateral (no parte del flujo). */
export const BARTER_FLOW: BarterStatus[] = [
  'pactado',
  'pendiente_envio',
  'enviado',
  'recibido',
  'contenido_pendiente',
  'contenido_publicado',
  'cerrado',
]

export const BARTER_STATUS_CONFIG: Record<
  BarterStatus,
  { label: string; short: string; color: string; badge: string }
> = {
  pactado:             { label: 'Pactado',             short: 'Pactado',     color: 'violet',  badge: 'badge-gray' },
  pendiente_envio:     { label: 'Pendiente de envío',  short: 'Por enviar',  color: 'amber',   badge: 'badge-orange' },
  enviado:             { label: 'Enviado',             short: 'Enviado',     color: 'blue',    badge: 'badge-blue' },
  recibido:            { label: 'Recibido',            short: 'Recibido',    color: 'cyan',    badge: 'badge-blue' },
  contenido_pendiente: { label: 'Contenido pendiente', short: 'Contenido',   color: 'amber',   badge: 'badge-orange' },
  contenido_publicado: { label: 'Contenido publicado', short: 'Publicado',   color: 'emerald', badge: 'badge-green' },
  cerrado:             { label: 'Cerrado',             short: 'Cerrado',     color: 'emerald', badge: 'badge-green' },
  con_problema:        { label: 'Con problema',        short: 'Problema',    color: 'red',     badge: 'badge-red' },
}

export interface BarterStatusHistoryEntry {
  id: string
  barter_id: string
  from_status: BarterStatus | null
  to_status: BarterStatus
  changed_by: string | null
  note: string | null
  created_at: string
  actor?: { id: string; full_name: string | null } | null
}

export interface Barter {
  id: string
  organization_id: string
  brand_id: string | null
  influencer_id: string
  campaign_id: string | null
  campaign_influencer_id: string | null
  item: string
  description: string | null
  estimated_value: number | null
  currency: Currency
  agreed_date: string | null
  responsible_id: string | null
  status: BarterStatus
  evidence_url: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  influencer?: { id: string; display_name: string; avatar_url: string | null } | null
  brand?: { id: string; name: string; logo_url: string | null } | null
  responsible?: { id: string; full_name: string | null } | null
  history?: BarterStatusHistoryEntry[]
}

export interface CreateBarterInput {
  influencer_id: string
  item: string
  brand_id?: string | null
  campaign_influencer_id?: string | null
  description?: string | null
  estimated_value?: number | null
  currency?: Currency
  agreed_date?: string | null
  responsible_id?: string | null
  notes?: string | null
}
