import { NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { fetchAllRows } from '@/lib/supabase/fetchAllRows'

const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'void', 'partially_paid'] as const

export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  if (!orgId) return NextResponse.json({ error: 'Organization not found' }, { status: 400 })

  const access = await getUserRole(user.id, orgId, admin)
  if (!access.isAdmin && access.role !== 'finance') {
    return NextResponse.json({ error: 'No tienes permisos para ver finanzas' }, { status: 403 })
  }

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthStartDate = monthStart.toISOString().slice(0, 10)

  const [invoicesResult, payrollResult] = await Promise.all([
    fetchAllRows(
      (from, to) => admin.from('invoices')
        .select('status,total,issue_date')
        .eq('organization_id', orgId)
        .range(from, to),
      { maxRows: 20000 },
    ),
    fetchAllRows(
      (from, to) => admin.from('payroll_runs')
        .select('status,total_amount,created_at')
        .eq('organization_id', orgId)
        .range(from, to),
      { maxRows: 20000 },
    ),
  ])

  if (invoicesResult.error || payrollResult.error) {
    console.error('[GET /api/billing/summary]', invoicesResult.error ?? payrollResult.error)
    return NextResponse.json({ error: 'No se pudo cargar el resumen financiero' }, { status: 500 })
  }

  const counts = Object.fromEntries(INVOICE_STATUSES.map(status => [status, 0])) as Record<string, number>
  let totalBilled = 0
  let totalPaid = 0
  let totalOverdue = 0
  let revenueMonth = 0

  for (const invoice of invoicesResult.data ?? []) {
    const status = String(invoice.status ?? '')
    const total = Number(invoice.total ?? 0)
    counts[status] = (counts[status] ?? 0) + 1
    if (status !== 'void') totalBilled += total
    if (status === 'paid') totalPaid += total
    if (status === 'overdue') totalOverdue += total
    if (['paid', 'sent'].includes(status) && String(invoice.issue_date ?? '') >= monthStartDate) revenueMonth += total
  }

  let totalPayroll = 0
  let payrollMonth = 0
  for (const run of payrollResult.data ?? []) {
    const status = String(run.status ?? '')
    const total = Number(run.total_amount ?? 0)
    if (status !== 'failed') totalPayroll += total
    if (['approved', 'processing', 'paid'].includes(status) && String(run.created_at ?? '') >= monthStart.toISOString()) {
      payrollMonth += total
    }
  }

  const margin = revenueMonth - payrollMonth
  return NextResponse.json({
    invoices: {
      total: invoicesResult.data?.length ?? 0,
      counts,
      total_billed: totalBilled,
      total_paid: totalPaid,
      total_overdue: totalOverdue,
    },
    payroll: { total_amount: totalPayroll },
    month: {
      revenue: revenueMonth,
      payroll: payrollMonth,
      margin,
      margin_pct: revenueMonth > 0 ? Math.round((margin / revenueMonth) * 100) : 0,
    },
  })
}
