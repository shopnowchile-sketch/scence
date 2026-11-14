import { NextRequest, NextResponse } from 'next/server'
import { authorizeBrandLocations } from '@/lib/brand-locations-auth'
import { addShare, listShares, removeShare } from '@/lib/location-sharing'

type Params = { params: { id: string } }

// Compartir un lugar PROPIO con otras marcas aprobadas. Solo marca propietaria con `location.manage`.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await authorizeBrandLocations('location.manage')
  if ('res' in auth) return auth.res
  return listShares(auth.admin, params.id, { userId: auth.userId, ownerBrandId: auth.access.brandId })
}
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeBrandLocations('location.manage')
  if ('res' in auth) return auth.res
  const body = await req.json().catch(() => ({}))
  return addShare(auth.admin, params.id, body?.brand_id, { userId: auth.userId, ownerBrandId: auth.access.brandId })
}
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeBrandLocations('location.manage')
  if ('res' in auth) return auth.res
  const brandId = new URL(req.url).searchParams.get('brand_id')
  return removeShare(auth.admin, params.id, brandId, { userId: auth.userId, ownerBrandId: auth.access.brandId })
}
