import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { PLAN_TIERS, resolveBrandPlan } from '@/lib/plan-limits'
import { resolveLastSeen } from '@/lib/supabase/lastSeen'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: brand, error: brandError } = await admin
    .from('brands')
    .select('*')
    .eq('id', params.id)
    .single()

  if (brandError) {
    if (brandError.code === 'PGRST116') return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    return NextResponse.json({ error: brandError.message }, { status: 500 })
  }

  const { data: primaryCampaigns } = await admin
    .from('campaigns')
    .select('id, name, status, budget_total, currency, created_at')
    .eq('brand_id', params.id)
    .order('created_at', { ascending: false })

  const { data: coBrandRows } = await admin
    .from('campaign_brands')
    .select('campaigns(id, name, status, budget_total, currency, created_at)')
    .eq('brand_id', params.id)

  const campaigns = [
    ...(primaryCampaigns ?? []),
    ...((coBrandRows ?? []).map((r: any) => r.campaigns).filter(Boolean)),
  ]

  const uniqueCampaigns = Array.from(new Map(campaigns.map((c: any) => [c.id, c])).values())

  // Última conexión — mismo criterio que GET /api/brands (lista, ver
  // resolveLastSeen): profiles.last_seen_at primero (heartbeat real del
  // portal), auth.users.last_sign_in_at como respaldo. Considera TODOS los
  // usuarios con acceso a esta marca (owner + brand_members), no solo el
  // owner — se muestra la conexión más reciente entre todos.
  const { data: memberRows } = await admin
    .from('brand_members')
    .select('user_id')
    .eq('brand_id', params.id)
    .not('user_id', 'is', null)

  const candidateUserIds = Array.from(new Set([
    ...(brand.user_id ? [brand.user_id] : []),
    ...(memberRows ?? []).map(m => m.user_id as string),
  ]))
  const lastSeenMap = await resolveLastSeen(admin, candidateUserIds)

  let last_sign_in_at: string | null = null
  for (const uid of candidateUserIds) {
    const seen = lastSeenMap[uid]
    if (seen && (!last_sign_in_at || new Date(seen).getTime() > new Date(last_sign_in_at).getTime())) {
      last_sign_in_at = seen
    }
  }

  // Plan interno efectivo individual de la marca.
  const org_plan = brand.organization_id
    ? await resolveBrandPlan(admin, brand.organization_id, brand.id)
    : 'basic'

  // Influencers agregadas/asignadas directamente a esta marca vía brand_influencers
  // (además de las que vienen por campañas, que el cliente resuelve aparte).
  // Usado por el tab "Influencers" del detalle de marca en admin.
  const { data: directRows } = await admin
    .from('brand_influencers')
    .select('influencer:influencers(id, display_name, avatar_url)')
    .eq('brand_id', params.id)

  const direct_influencers = ((directRows ?? [])
    .map(r => r.influencer)
    .filter(Boolean)) as unknown as Array<{ id: string; display_name: string; avatar_url: string | null }>

  return NextResponse.json({ data: { ...brand, campaigns: uniqueCampaigns, last_sign_in_at, org_plan, direct_influencers } })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id: _id, organization_id: _oi, created_by: _cb, created_at: _ca, ...rest } = body

  if ('instagram' in rest) {
    rest.instagram = typeof rest.instagram === 'string'
      ? rest.instagram.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '') || null
      : null
  }

  // FIX (bug Limitless, 2026-07-13): editar contact_email acá solo tocaba la
  // columna brands.contact_email — auth.users nunca se enteraba, el owner
  // seguía logueado (o intentando loguear) con el email viejo. Ahora, si el
  // email de contacto cambia realmente, se sincroniza también auth.users (el
  // MISMO user_id, nunca uno nuevo) y brand_members.email. Gate de
  // super_admin solo cuando cambia contact_email — el resto de campos de la
  // marca conserva los permisos de siempre.
  let pendingAuthRollback: { userId: string; previousEmail: string | null } | null = null

  if ('contact_email' in rest) {
    const rawEmail = rest.contact_email
    const newEmail = rawEmail ? String(rawEmail).trim().toLowerCase() : null

    const { data: currentBrand, error: currentBrandErr } = await admin
      .from('brands')
      .select('user_id, contact_email')
      .eq('id', params.id)
      .single()

    if (currentBrandErr) {
      console.error('[PATCH /api/brands/[id]] no se pudo leer la marca actual:', currentBrandErr.message)
      return NextResponse.json({ error: 'No se pudo verificar la marca' }, { status: 500 })
    }

    const previousEmailNormalized = (currentBrand.contact_email ?? '').trim().toLowerCase()

    if (newEmail && newEmail !== previousEmailNormalized) {
      // Cambio real de correo de contacto → gate de super_admin.
      const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (profile?.role !== 'super_admin') {
        return NextResponse.json(
          { error: 'Solo un super_admin puede cambiar el correo del owner de una marca' },
          { status: 403 },
        )
      }

      if (!currentBrand.user_id) {
        return NextResponse.json(
          { error: 'Esta marca no tiene owner vinculado. Requiere reparación administrativa antes de poder cambiar el correo.' },
          { status: 422 },
        )
      }

      // Fuente de verdad real: el email actual en auth.users, no
      // brands.contact_email (que puede ya estar desincronizado de una
      // edición anterior a este fix).
      const { data: ownerAuth, error: ownerAuthErr } = await admin.auth.admin.getUserById(currentBrand.user_id)
      if (ownerAuthErr || !ownerAuth?.user) {
        console.error('[PATCH /api/brands/[id]] owner auth user no encontrado:', ownerAuthErr?.message)
        return NextResponse.json({ error: 'Usuario de autenticación del owner no encontrado' }, { status: 404 })
      }
      const previousAuthEmail = ownerAuth.user.email ?? null

      if (previousAuthEmail?.toLowerCase() !== newEmail) {
        // Colisión — búsqueda paginada (mismo patrón que crm-leads/[id]):
        // con >1.6k usuarios, una sola página de listUsers() no alcanza.
        let page = 1
        let collision = false
        for (;;) {
          const { data: usersPage, error: usersErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
          if (usersErr || !usersPage?.users?.length) break
          if (usersPage.users.some(u => u.id !== currentBrand.user_id && u.email?.toLowerCase() === newEmail)) {
            collision = true
            break
          }
          if (usersPage.users.length < 1000) break
          page++
        }
        if (collision) {
          return NextResponse.json({ error: 'Este correo ya está asociado a otra cuenta' }, { status: 409 })
        }

        const { error: authUpdateErr } = await admin.auth.admin.updateUserById(currentBrand.user_id, {
          email: newEmail,
          email_confirm: true,
        })
        if (authUpdateErr) {
          console.error('[PATCH /api/brands/[id]] fallo actualizando auth.users:', authUpdateErr.message)
          return NextResponse.json({ error: 'No se pudo actualizar el usuario de autenticación' }, { status: 500 })
        }

        // Guardado para poder revertir si el update de `brands` de más abajo falla.
        pendingAuthRollback = { userId: currentBrand.user_id, previousEmail: previousAuthEmail }

        // Sync secundario, NO bloqueante: brand_members.email para ese mismo
        // user_id (si el owner también tiene una fila ahí — ver caso
        // alexrabi91 en resolveBrandAccess). Un fallo acá no aborta el
        // cambio principal porque brand_members no es la fuente de verdad
        // de acceso (auth.users + brands.user_id lo son).
        const { error: membersErr } = await admin
          .from('brand_members')
          .update({ email: newEmail })
          .eq('user_id', currentBrand.user_id)
        if (membersErr) {
          console.error('[PATCH /api/brands/[id]] sync brand_members.email falló (no bloqueante):', membersErr.message)
        }
      }
    }

    rest.contact_email = newEmail
  }

  if ('subscription_plan_override' in rest) {
    const rawValue = rest.subscription_plan_override
    const normalized =
      rawValue === null || rawValue === undefined || rawValue === ''
        ? null
        : String(rawValue).toLowerCase().trim()

    if (
      normalized !== null &&
      !(PLAN_TIERS as readonly string[]).includes(normalized)
    ) {
      return NextResponse.json(
        { error: 'El plan debe ser basic, growth, pro o heredar' },
        { status: 422 },
      )
    }

    rest.subscription_plan_override = normalized
  }

  // Suspender una marca que tenía acceso comercial manual revoca ese permiso
  // gratuito. Al volver a entrar, el portal la redirige a Planes para que
  // contrate una suscripción. No toca una suscripción pagada existente.
  if (rest.status === 'suspended') {
    rest.subscription_plan_override = null
  }

  const { data, error } = await admin
    .from('brands')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    // Rollback compensatorio: si ya cambiamos auth.users más arriba pero
    // este update de `brands` falla, auth.users.email y brands.contact_email
    // quedarían desincronizados (el mismo bug que originó este fix, al
    // revés). auth.users.email + brands.contact_email deben ser siempre
    // consistentes — se prioriza esa consistencia sobre dejar el cambio de
    // auth a medias.
    if (pendingAuthRollback) {
      const { error: rollbackErr } = await admin.auth.admin.updateUserById(pendingAuthRollback.userId, {
        email: pendingAuthRollback.previousEmail ?? undefined,
      })
      if (rollbackErr) {
        console.error(
          '[PATCH /api/brands/[id]] ROLLBACK DE EMAIL FALLÓ — auth.users quedó con el email nuevo pero brands.contact_email no se actualizó. Requiere reparación manual.',
          { brandId: params.id, userId: pendingAuthRollback.userId, rollbackError: rollbackErr.message },
        )
      }
    }
    console.error('[PATCH /api/brands/[id]] update de brands falló:', error.message)
    return NextResponse.json({ error: 'No se pudo guardar los cambios de la marca' }, { status: 500 })
  }

  // Auto-asignación de marca colaboradora tras aprobación (2026-07-12, pedido
  // de Pri): si esta marca fue creada desde el flujo de "marcas colaboradoras"
  // (POST /api/campaigns/[id]/brands con email nuevo) quedó marcada en
  // metadata.pending_collab_campaign_id, SIN asignar todavía. Recién ahora que
  // Admin la aprueba se la asigna a esa campaña — nunca antes. Idempotente: se
  // limpia la metadata apenas se usa, así un PATCH posterior no la reasigna.
  const meta = (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata))
    ? (data.metadata as Record<string, unknown>)
    : {}
  const pendingCampaignId = meta.pending_collab_campaign_id as string | undefined

  if (data.status === 'approved' && pendingCampaignId) {
    try {
      const { error: assignError } = await admin
        .from('campaign_brands')
        .upsert({
          campaign_id: pendingCampaignId,
          brand_id: data.id,
          role: 'collaborator',
          assigned_by: user.id,
        }, { onConflict: 'campaign_id,brand_id' })

      if (assignError) {
        console.error('[PATCH /api/brands/[id]] auto-asignación de co-marca falló:', assignError.message)
      } else {
        const { pending_collab_campaign_id: _drop1, invited_by_brand_id: _drop2, ...restMeta } = meta
        await admin.from('brands').update({ metadata: restMeta }).eq('id', data.id)
      }
    } catch (e) {
      console.error('[PATCH /api/brands/[id]] auto-asignación de co-marca — error no bloqueante:', e)
    }
  }

  const org_plan = data.organization_id
    ? await resolveBrandPlan(admin, data.organization_id, data.id)
    : 'basic'

  return NextResponse.json({ data: { ...data, org_plan } })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { error } = await admin
    .from('brands')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
