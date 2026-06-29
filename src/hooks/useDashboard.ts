import { useQuery } from '@tanstack/react-query'

export interface DashboardData {
  kpis: {
    active_campaigns: number
    total_influencers: number
    revenue_month: number
    payroll_month: number
    margin: number
    margin_pct: number
  }
  pending_deliverables: Array<{
    id: string
    title: string
    status: string
    due_date: string
    platform: string
    influencer: { id: string; display_name: string; avatar_url: string | null }
    campaign: { id: string; name: string }
  }>
  recent_activity: Array<{
    id: string
    name: string
    status: string
    updated_at: string
  }>
  revenue_chart: Array<{
    month: string
    revenue: number
    payroll: number
  }>
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch('/api/dashboard')
  if (!res.ok) throw new Error('Error al cargar dashboard')
  return res.json()
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn:  fetchDashboard,
    staleTime: 1000 * 60 * 5, // 5 min
  })
}
