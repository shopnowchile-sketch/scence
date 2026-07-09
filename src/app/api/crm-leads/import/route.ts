import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'

async function isAdminUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return ['super_admin', 'brand_manager'].includes(String(data?.role ?? ''))
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]

    if (c === '"' && inQuotes && next === '"') {
      cell += '"'
      i++
      continue
    }

    if (c === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (c === ',' && !inQuotes) {
      row.push(cell.trim())
      cell = ''
      continue
    }

    if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && next === '\n') i++
      row.push(cell.trim())
      cell = ''
      if (row.some(v => v.length > 0)) rows.push(row)
      row = []
      continue
    }

    cell += c
  }

  row.push(cell.trim())
  if (row.some(v => v.length > 0)) rows.push(row)

  return rows
}

function normalizeHeader(header: string) {
  const h = header.trim().toLowerCase().replace(/\s+/g, '_')

  const aliases: Record<string, string> = {
    empresa: 'company_name',
    razon_social: 'company_name',
    razón_social: 'company_name',
    nombre_empresa: 'company_name',
    company: 'company_name',
    company_name: 'company_name',

    contacto: 'contact_name',
    nombre_contacto: 'contact_name',
    contact_name: 'contact_name',

    correo: 'email',
    mail: 'email',
    email: 'email',

    telefono: 'phone_1',
    teléfono: 'phone_1',
    phone: 'phone_1',
    phone_1: 'phone_1',
    celular: 'phone_1',

    instagram: 'instagram',
    ig: 'instagram',
    handle: 'instagram',
    usuario_instagram: 'instagram',

    comuna: 'commune',
    ciudad: 'commune',
    city: 'commune',
    commune: 'commune',

    region: 'region',
    región: 'region',

    rubro: 'industry',
    categoria: 'industry',
    categoría: 'industry',
    category: 'industry',
    industry: 'industry',

    origen: 'source',
    source: 'source',

    sitio_web: 'website',
    website: 'website',
    web: 'website',
  }

  return aliases[h] ?? h
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await isAdminUser(user.id, admin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Debes subir un archivo CSV' }, { status: 422 })
  }

  const csvText = await file.text()
  const rows = parseCsv(csvText)

  if (rows.length < 2) {
    return NextResponse.json({ error: 'El CSV debe tener encabezados y al menos una fila' }, { status: 422 })
  }

  const headers = rows[0].map(normalizeHeader)
  const bodyRows = rows.slice(1, 501)

  const parsed = bodyRows.map((row, index) => {
    const item: Record<string, string> = {}
    headers.forEach((header, i) => {
      item[header] = String(row[i] ?? '').trim()
    })

    const email = (item.email ?? '').trim().toLowerCase()
    const companyName = (item.company_name ?? '').trim()
    const instagram = (item.instagram ?? '').trim()

    return {
      index: index + 2,
      company_name: companyName || null,
      contact_name: (item.contact_name ?? '').trim() || null,
      email: email || null,
      phone_1: (item.phone_1 ?? '').trim() || null,
      instagram: instagram || null,
      website: (item.website ?? '').trim() || null,
      commune: (item.commune ?? '').trim() || null,
      region: (item.region ?? '').trim() || null,
      industry: (item.industry ?? '').trim() || null,
      source: (item.source ?? '').trim() || 'csv_import',
      qualification_status: 'unqualified',
      imported_at: new Date().toISOString(),
    }
  })

  // Un lead solo-Instagram (sin empresa ni email, ej. prospección manual
  // desde un CSV exportado de Instagram) también es válido — mismo criterio
  // que ya usan las scheduled tasks de prospección al insertar directo.
  const invalid = parsed.filter(r => !r.company_name && !r.email && !r.instagram)
  const valid = parsed.filter(r => r.company_name || r.email || r.instagram)

  const emails = Array.from(new Set(valid.map(r => r.email).filter(Boolean))) as string[]
  const existingEmails = new Set<string>()

  if (emails.length > 0) {
    const { data: existing } = await admin
      .from('crm_leads')
      .select('email')
      .in('email', emails)

    for (const row of existing ?? []) {
      if (row.email) existingEmails.add(String(row.email).toLowerCase())
    }
  }

  // Dedup por Instagram handle también — mismo criterio que ya usan las
  // scheduled tasks de prospección (comparan por handle antes de insertar),
  // necesario para leads que no tienen email (solo-Instagram).
  const instagramHandles = Array.from(new Set(valid.map(r => r.instagram).filter(Boolean))) as string[]
  const existingInstagram = new Set<string>()

  if (instagramHandles.length > 0) {
    const { data: existing } = await admin
      .from('crm_leads')
      .select('instagram')
      .in('instagram', instagramHandles)

    for (const row of existing ?? []) {
      if (row.instagram) existingInstagram.add(String(row.instagram).toLowerCase())
    }
  }

  const seenEmails = new Set<string>()
  const seenInstagram = new Set<string>()
  const duplicates: typeof valid = []
  const toInsert: typeof valid = []

  for (const row of valid) {
    if (row.email) {
      if (existingEmails.has(row.email) || seenEmails.has(row.email)) {
        duplicates.push(row)
        continue
      }
      seenEmails.add(row.email)
    } else if (row.instagram) {
      const ig = row.instagram.toLowerCase()
      if (existingInstagram.has(ig) || seenInstagram.has(ig)) {
        duplicates.push(row)
        continue
      }
      seenInstagram.add(ig)
    }
    toInsert.push(row)
  }

  let inserted = 0
  let errors = 0

  if (toInsert.length > 0) {
    const cleanRows = toInsert.map(({ index: _index, ...row }) => row)
    const { data, error } = await admin
      .from('crm_leads')
      .insert(cleanRows)
      .select('id')

    if (error) {
      console.error('[POST /api/crm-leads/import]', error)
      errors = toInsert.length
    } else {
      inserted = data?.length ?? 0
    }
  }

  return NextResponse.json({
    imported: inserted,
    duplicates: duplicates.length,
    invalid: invalid.length,
    errors,
    limited_to_500: rows.length > 501,
  })
}
