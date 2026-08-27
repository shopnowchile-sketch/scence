import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId } from '@/lib/supabase/ensureOrg'
import { isCrmAdmin } from '@/lib/crm-auth'

type Params = { params: { id: string } }

const VALID_STATUS = ['unqualified', 'qualified', 'rejected', 'contacted', 'converted']

// ── GET /api/crm-leads/[id] — detalle + historial de actividad ────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: lead, error } = await admin
    .from('crm_leads')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 })

  const { data: activities } = await admin
    .from('crm_lead_activities')
    .select('id, action_type, description, created_at, created_by')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false })

  const { data: emailEvents } = await admin
    .from('crm_email_events')
    .select('id, event_type, recipient_email, subject, resend_email_id, occurred_at, created_at, raw_payload')
    .eq('lead_id', params.id)
    .order('occurred_at', { ascending: false })

  const enrichedActivities = [...(activities ?? [])]
  const legacyNote = typeof lead.qualification_notes === 'string' ? lead.qualification_notes.trim() : ''
  if (legacyNote && !enrichedActivities.some(activity => activity.action_type === 'note' && activity.description?.trim() === legacyNote)) {
    enrichedActivities.push({
      id: `legacy-note-${lead.id}`,
      action_type: 'note',
      description: legacyNote,
      created_at: lead.updated_at ?? lead.created_at,
      created_by: null,
    })
    enrichedActivities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  // Conexión a la app — mismo criterio que /api/crm-leads (lista): cruza el
  // email del lead contra auth.users vía admin.auth.admin.listUsers(). Un solo
  // lead, no hace falta traer todos los usuarios: se pagina hasta encontrarlo
  // o agotar la lista.
  let appConnected = false
  let appLastSignInAt: string | null = null
  if (lead.email) {
    const target = lead.email.toLowerCase()
    let page = 1
    const perPage = 1000
    for (;;) {
      const { data: usersPage, error: usersErr } = await admin.auth.admin.listUsers({ page, perPage })
      if (usersErr || !usersPage?.users?.length) break
      const match = usersPage.users.find(u => u.email?.toLowerCase() === target)
      if (match) { appConnected = true; appLastSignInAt = match.last_sign_in_at ?? null; break }
      if (usersPage.users.length < perPage) break
      page++
    }
  }

  const emailTypeByResendId = new Map<string, string>()
  for (const event of emailEvents ?? []) {
    const rawPayload = event.raw_payload as Record<string, unknown> | null
    const emailType = typeof rawPayload?.email_type === 'string' ? rawPayload.email_type : null
    if (event.resend_email_id && emailType) emailTypeByResendId.set(event.resend_email_id, emailType)
  }

  const enrichedEmailEvents = (emailEvents ?? []).map(event => ({
    ...event,
    email_type: event.resend_email_id ? emailTypeByResendId.get(event.resend_email_id) ?? null : null,
    raw_payload: undefined,
  }))

  return NextResponse.json({
    data: { ...lead, activities: enrichedActivities, email_events: enrichedEmailEvents, app_connected: appConnected, app_last_sign_in_at: appLastSignInAt },
  })
}

// ── PATCH /api/crm-leads/[id] — actualizar calificación/notas ─────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isCrmAdmin(user, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.qualification_status !== undefined) {
    if (!VALID_STATUS.includes(body.qualification_status)) {
      return NextResponse.json({ error: 'qualification_status inválido' }, { status: 422 })
    }
    update.qualification_status = body.qualification_status
    if (body.qualification_status === 'qualified' || body.qualification_status === 'rejected') {
      update.qualified_at = new Date().toISOString()
    }
    // FIX: antes solo el envío automático de email (send-intro/route.ts)
    // marcaba contacted_at — al cambiar el estado a mano (ej. después de un
    // DM de Instagram/WhatsApp) el estado quedaba en "Contactado" pero
    // "Último contacto" seguía en "Nunca" para siempre.
    if (body.qualification_status === 'contacted') {
      update.contacted_at = new Date().toISOString()
    }
  }
  if (body.qualification_notes !== undefined) update.qualification_notes = body.qualification_notes

  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (body.note !== undefined && !note) {
    return NextResponse.json({ error: 'La nota no puede estar vacía' }, { status: 422 })
  }
  if (note) update.qualification_notes = note

  const { data, error } = await admin
    .from('crm_leads')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (body.qualification_status) {
    const actionTypeByStatus: Record<string, string> = {
      unqualified: 'status_changed',
      qualified: 'qualified',
      rejected: 'rejected',
      contacted: 'contacted',
      converted: 'converted',
    }
    await admin.from('crm_lead_activities').insert({
      lead_id: params.id,
      action_type: actionTypeByStatus[body.qualification_status] ?? 'note',
      description: `Estado cambiado a "${body.qualification_status}"`,
      created_by: user.id,
    })
  }

  if (note) {
    const { error: noteError } = await admin.from('crm_lead_activities').insert({
      lead_id: params.id,
      action_type: 'note',
      description: note,
      created_by: user.id,
    })

    if (noteError) {
      console.error('[PATCH /api/crm-leads/[id]] error guardando historial de nota', noteError)
      return NextResponse.json({ error: 'No se pudo registrar la nota en el historial' }, { status: 500 })
    }
  }

  // ── Integración CRM -> Brands ─────────────────────────────────────────────
  // Al convertir un lead (qualification_status = 'converted') se crea
  // automáticamente la marca en `brands` con los campos mapeados, y se deja
  // el vínculo en `crm_leads.converted_brand_id` — columna que ya existía
  // desde la migración original (20260703000000_crm_leads.sql) pero nunca se
  // había usado. Idempotente: si el lead ya tiene converted_brand_id (porque
  // ya se convirtió antes), NO crea una segunda marca aunque se repita el
  // PATCH — así que reintentar tras un error es seguro.
  let convertedBrandId: string | null = data.converted_brand_id ?? null
  let brandCreated = false

  if (body.qualification_status === 'converted' && !data.converted_brand_id) {
    const brandName = data.company_name || data.contact_name || data.email || data.instagram

    if (!brandName) {
      return NextResponse.json({
        data,
        error: 'Estado actualizado a "Convertido", pero no se pudo crear la marca: el lead no tiene empresa, contacto, email ni Instagram para usar como nombre.',
      }, { status: 422 })
    }

    const orgId = await getOrgId(user.id, user.user_metadata, admin)
    if (!orgId) {
      return NextResponse.json({
        data,
        error: 'Estado actualizado a "Convertido", pero no se encontró organización para crear la marca.',
      }, { status: 400 })
    }

    const noteParts = [
      data.qualification_notes ? String(data.qualification_notes).trim() : null,
      `Convertido automáticamente desde el CRM (lead ${data.id}, fuente: ${data.source ?? 'desconocida'}).`,
    ].filter(Boolean)

    const { data: brand, error: brandError } = await admin
      .from('brands')
      .insert({
        organization_id: orgId,
        created_by: user.id,
        name: brandName,
        website: data.website ?? null,
        industry: data.industry ?? null,
        instagram: data.instagram ?? null,
        contact_name: data.contact_name ?? null,
        contact_email: data.email ?? null,
        contact_phone: data.phone_1 ?? null,
        address_city: data.commune ?? null,
        address_region: data.region ?? null,
        rut: data.company_rut ?? null,
        notes: noteParts.join(' · '),
      })
      .select('id')
      .single()

    if (brandError) {
      console.error('[PATCH /api/crm-leads/[id]] error creando marca desde lead convertido', brandError)
      return NextResponse.json({
        data,
        error: `Estado actualizado a "Convertido", pero no se pudo crear la marca: ${brandError.message}`,
      }, { status: 500 })
    }

    convertedBrandId = brand.id
    brandCreated = true

    await admin.from('crm_leads').update({ converted_brand_id: convertedBrandId }).eq('id', params.id)

    await admin.from('crm_lead_activities').insert({
      lead_id: params.id,
      action_type: 'note',
      description: `Marca creada automáticamente en SCENCE al convertir el lead (brand ${convertedBrandId}).`,
      created_by: user.id,
    })
  }

  return NextResponse.json({ data: { ...data, converted_brand_id: convertedBrandId }, brand_created: brandCreated })
}
