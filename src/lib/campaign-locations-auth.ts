import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { authorizeCampaignBrandAction, type CampaignBrandAuthorization } from '@/lib/campaign-brand-access'
import type { BrandPermission } from '@/lib/supabase/ensureOrg'

export type CampaignLocationsAuth =
  | { ok: true; auth: CampaignBrandAuthorization; userId: string }
  | { ok: false; response: NextResponse }

/**
 * Autoriza una operación sobre las direcciones de UNA campaña.
 *   · Admin de plataforma: todas las campañas.
 *   · Marca: solo campañas propias (brand_id / created_by_brand_id) y con el permiso pedido.
 * Una marca ajena recibe 404, igual que /api/brand/campaigns/[id]: no se revela que existe.
 */
export async function authorizeCampaignLocations(
  campaignId: string,
  permission: Extract<BrandPermission, 'campaign.read' | 'campaign.manage'>,
): Promise<CampaignLocationsAuth> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const auth = await authorizeCampaignBrandAction(user.id, campaignId, permission)
  if (!auth) return { ok: false, response: NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 }) }
  return { ok: true, auth, userId: user.id }
}
