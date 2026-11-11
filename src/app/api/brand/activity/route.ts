import { NextResponse } from 'next/server'
import { brandSection, recordBrandActivity } from '@/lib/brand-activity'
import { pendingBrandPathAllowed } from '@/lib/brand-status-access'
import { hasBrandPermission, resolveBrandAccess } from '@/lib/supabase/ensureOrg'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { data: { user }, error } = await createServerClient().auth.getUser()
  if (error || !user) return new NextResponse(null, { status: 401 })

  const body = await request.json().catch(() => null)
  const path = typeof body?.path === 'string' ? body.path : ''
  const section = brandSection(path)
  if (!section) return new NextResponse(null, { status: 422 })

  const access = await resolveBrandAccess(user.id)
  if (!access) return new NextResponse(null, { status: 403 })
  const planAllowed = section === 'plan' && (access.status === 'suspended' || access.status === 'pending_approval')
  const pendingAllowed = access.status === 'pending_approval' && pendingBrandPathAllowed(path)
  if (!hasBrandPermission(access, 'brand.read') || (access.status !== 'approved' && !planAllowed && !pendingAllowed)) {
    return new NextResponse(null, { status: 403 })
  }

  await recordBrandActivity(createAdminClient(), access, user.id, section)
  return new NextResponse(null, { status: 204 })
}
