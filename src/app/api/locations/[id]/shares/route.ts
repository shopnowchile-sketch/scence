import { NextRequest } from 'next/server'
import { authorizeLocationsAdmin } from '@/lib/locations-server'
import { addShare, listShares, removeShare } from '@/lib/location-sharing'

type Params = { params: { id: string } }

// Admin de plataforma: gestiona los accesos compartidos de cualquier lugar.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await authorizeLocationsAdmin()
  if ('res' in auth) return auth.res
  return listShares(auth.admin, params.id, { userId: auth.user.id, ownerBrandId: null })
}
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authorizeLocationsAdmin()
  if ('res' in auth) return auth.res
  const body = await req.json().catch(() => ({}))
  return addShare(auth.admin, params.id, body?.brand_id, { userId: auth.user.id, ownerBrandId: null })
}
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeLocationsAdmin()
  if ('res' in auth) return auth.res
  return removeShare(auth.admin, params.id, new URL(req.url).searchParams.get('brand_id'), { userId: auth.user.id, ownerBrandId: null })
}
