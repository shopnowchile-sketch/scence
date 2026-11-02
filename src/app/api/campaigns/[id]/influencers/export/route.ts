import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { hasBrandPermission, isPlatformAdmin, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { getOfficialLocationDisplayMap } from '@/lib/influencer-location'
import { getAttendanceState, getCampaignDateKey } from '@/lib/attendance-state'
import { isAttendanceConfirmed, isAttendanceDeliverable, isDeliverableComplete, isDeliverableOverdue } from '@/lib/deliverable-status'
import { formatRut } from '@/lib/rut'
import {
  DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS, csvCell, parseExportColumns, parseExportFilter, parseExportFormat,
  type ExportColumnKey,
} from '@/lib/campaign-export-columns'

type Params = { params: { id: string } }

const ATTENDANCE_LABEL = {
  confirmed: 'Confirmada', declined: 'Declinada', no_confirmed: 'Sin respuesta (vencida)', unconfirmed: 'Pendiente',
} as const

// GET /api/campaigns/[id]/influencers/export?filter=confirmed|approved|all&columns=a,b,c&format=xlsx|csv
// Descarga datos personales únicamente de participantes aceptadas (application_status = 'accepted').
// Disponible para Admin y para la marca dueña/creadora; no para co-marcas de solo lectura.
// Columnas: lista cerrada (lib/campaign-export-columns.ts). El RUT es solo para admin de plataforma.
export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, organization_id, brand_id, created_by_brand_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!campaign) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

  // Administración de plataforma primero (super_admin ACTIVO); el resto, solo la marca dueña/creadora con report.read.
  let authorized = false
  const platformAdmin = await isPlatformAdmin(user.id, admin)
  const access = platformAdmin ? null : await resolveBrandAccess(user.id)
  if (platformAdmin) {
    authorized = true
  } else if (access) {
    authorized = hasBrandPermission(access, 'report.read') && (
      campaign.brand_id === access.brandId || campaign.created_by_brand_id === access.brandId
    )
  }

  if (!authorized) return NextResponse.json({ error: 'No tienes permiso para descargar estos datos' }, { status: 403 })

  const url = new URL(req.url)
  const filter = parseExportFilter(url.searchParams.get('filter'))
  const format = parseExportFormat(url.searchParams.get('format'))
  const requestedColumns = url.searchParams.has('columns') ? parseExportColumns(url.searchParams.get('columns')) : DEFAULT_EXPORT_COLUMNS
  if (requestedColumns.length === 0) return NextResponse.json({ error: 'Elige al menos una columna' }, { status: 422 })
  // El RUT es dato personal sensible: solo administración de plataforma (decisión de la fundadora, 2026-11-02).
  const adminOnlyKeys = new Set(EXPORT_COLUMNS.filter(column => column.adminOnly).map(column => column.key))
  if (!platformAdmin && requestedColumns.some(key => adminOnlyKeys.has(key))) {
    return NextResponse.json({ error: 'No tienes permiso para exportar esa columna' }, { status: 403 })
  }
  const columns = EXPORT_COLUMNS.filter(column => requestedColumns.includes(column.key))

  const { data: participants, error } = await admin
    .from('campaign_influencers')
    .select(`
      influencer_id, fee, currency, accepted_at, updated_at, application_status,
      influencer:influencers (
        display_name, email, phone, whatsapp, location_id, categories,
        influencer_social_profiles (platform, username, followers, engagement_rate)
      )
    `)
    .eq('campaign_id', params.id)
    .eq('application_status', 'accepted')
    .order('updated_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Entregables de la campaña: asistencia (confirmación) y contenido (estado). Siempre con attendance_response (16.14).
  const { data: deliverables, error: deliverablesError } = await admin
    .from('campaign_deliverables')
    .select('influencer_id, type, status, content_url, published_url, attendance_response, due_date')
    .eq('campaign_id', params.id)
  if (deliverablesError) return NextResponse.json({ error: deliverablesError.message }, { status: 500 })

  type Deliverable = NonNullable<typeof deliverables>[number]
  const byInfluencer = new Map<string, Deliverable[]>()
  for (const row of deliverables ?? []) {
    if (!row.influencer_id) continue
    byInfluencer.set(row.influencer_id, [...(byInfluencer.get(row.influencer_id) ?? []), row])
  }
  const attendanceOf = (influencerId: string) => (byInfluencer.get(influencerId) ?? []).find(isAttendanceDeliverable)
  const confirmed = (influencerId: string) => { const row = attendanceOf(influencerId); return !!row && isAttendanceConfirmed(row) }

  const selected = (participants ?? []).filter(item => {
    const isConfirmed = confirmed(item.influencer_id as string)
    if (filter === 'confirmed') return isConfirmed
    if (filter === 'approved') return !isConfirmed
    return true
  })

  type Social = { platform: string; username: string | null; followers: number | null; engagement_rate: number | null }
  type Influencer = {
    display_name: string; email: string | null; phone: string | null; whatsapp: string | null
    location_id: string | null; categories: string[] | null; influencer_social_profiles: Social[] | null
  }
  const locationDisplayById = await getOfficialLocationDisplayMap(admin)

  // RUT: solo si se pidió y el usuario es admin (ya validado arriba); solo de las influencers aceptadas seleccionadas.
  const ruts = new Map<string, string>()
  if (platformAdmin && requestedColumns.includes('rut') && selected.length > 0) {
    const { data: rutRows, error: rutError } = await admin
      .from('influencer_private_data')
      .select('influencer_id, rut')
      .in('influencer_id', selected.map(item => item.influencer_id as string))
    if (rutError) return NextResponse.json({ error: rutError.message }, { status: 500 })
    for (const row of rutRows ?? []) if (row.rut) ruts.set(row.influencer_id as string, row.rut as string)
  }

  const todayKey = getCampaignDateKey()
  const rows = selected.map(item => {
    const influencer = item.influencer as unknown as Influencer | null
    const influencerId = item.influencer_id as string
    const instagram = influencer?.influencer_social_profiles?.find(profile => profile.platform === 'instagram')
    const location = influencer?.location_id ? locationDisplayById.get(influencer.location_id) : undefined
    const attendance = attendanceOf(influencerId)
    const content = (byInfluencer.get(influencerId) ?? []).filter(row => !isAttendanceDeliverable(row))
    const done = content.filter(isDeliverableComplete).length
    const overdue = content.filter(row => isDeliverableOverdue(row, todayKey)).length
    const values: Record<ExportColumnKey, string | number> = {
      name: influencer?.display_name ?? '',
      instagram: instagram?.username ? `@${instagram.username.replace(/^@/, '')}` : '',
      followers: instagram?.followers ?? '',
      engagement: instagram?.engagement_rate ?? '',
      rut: ruts.has(influencerId) ? formatRut(ruts.get(influencerId)) : '',
      phone: influencer?.phone ?? '',
      whatsapp: influencer?.whatsapp ?? '',
      email: influencer?.email ?? '',
      attendance: attendance ? ATTENDANCE_LABEL[getAttendanceState(attendance.attendance_response, attendance.due_date)] : '',
      commune: location?.commune ?? '',
      region: location?.region ?? '',
      country: location?.country ?? '',
      categories: influencer?.categories?.join(', ') ?? '',
      deliverables: content.length === 0 ? 'Sin entregables' : `${done}/${content.length} completados${overdue ? ` · ${overdue} vencido${overdue === 1 ? '' : 's'}` : ''}`,
      fee: item.fee ?? '',
      currency: item.currency ?? 'CLP',
      accepted_at: (item.accepted_at ?? item.updated_at) ? new Date(item.accepted_at ?? item.updated_at).toLocaleString('es-CL') : '',
    }
    return Object.fromEntries(columns.map(column => [column.label, values[column.key]])) as Record<string, string | number>
  })

  const safeName = campaign.name.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '-').replace(/^-|-$/g, '')
  const baseName = `influencers-${filter === 'confirmed' ? 'confirmadas' : filter === 'approved' ? 'aprobadas' : 'seleccionadas'}-${safeName || 'campana'}`
  const headers = columns.map(column => column.label)

  if (format === 'csv') {
    const lines = [headers, ...rows.map(row => headers.map(header => row[header]))].map(line => line.map(csvCell).join(','))
    return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SCENCE'
  const worksheet = workbook.addWorksheet('Influencers')
  worksheet.columns = columns.map(column => ({ header: column.label, key: column.label, width: column.width }))
  rows.forEach(row => worksheet.addRow(row))
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(rows.length + 1, 1), column: columns.length } }
  const output = await workbook.xlsx.writeBuffer()

  return new NextResponse(new Uint8Array(output), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${baseName}.xlsx"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
