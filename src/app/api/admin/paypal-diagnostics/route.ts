import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { getInfluencerPayPalToken, influencerPayPalBaseUrl, parseInfluencerReference } from '@/lib/influencer-paypal'

export const maxDuration = 60

// GET /api/admin/paypal-diagnostics
//
// Diagnóstico admin-only del Plan Pro. Nace de un caso real: 6 suscripciones
// creadas en PayPal, 0 activas, y ninguna forma de ver desde SCENCE en qué
// paso se rompía. Contesta las 4 preguntas que importan sin exponer ningún
// secreto (solo devuelve si cada variable está definida, nunca su valor):
//
//   1. ¿La app apunta a PayPal live o sandbox?
//   2. ¿A qué URL está mandando PayPal sus webhooks y qué eventos incluye?
//      (si la URL no es /api/paypal/webhook, ninguna suscripción se activa)
//   3. ¿El plan configurado existe y está activo en PayPal?
//   4. ¿Cuál es el estado REAL en PayPal de cada suscripción de la base?
export async function GET() {
  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = {
    paypal_env: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    api_base: influencerPayPalBaseUrl(),
    has_client_id: Boolean(process.env.PAYPAL_CLIENT_ID),
    has_client_secret: Boolean(process.env.PAYPAL_CLIENT_SECRET),
    // El código de /api/paypal/webhook lee PAYPAL_WEBHOOK_ID. Si solo está
    // definida PAYPAL_INFLUENCER_WEBHOOK_ID, el webhook responde 503 y NINGÚN
    // evento de PayPal se procesa jamás.
    has_webhook_id: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    has_influencer_webhook_id: Boolean(process.env.PAYPAL_INFLUENCER_WEBHOOK_ID),
    pro_plan_id: process.env.PAYPAL_INFLUENCER_PRO_PLAN_ID ?? null,
  }

  const token = await getInfluencerPayPalToken()
  if (!token) {
    return NextResponse.json({ config, error: 'No se pudo autenticar contra PayPal con las credenciales configuradas.' }, { status: 502 })
  }

  const call = async (path: string) => {
    const response = await fetch(`${influencerPayPalBaseUrl()}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const body = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, body }
  }

  // Webhooks registrados en PayPal: acá se ve si la URL configurada es la que
  // el código realmente expone.
  const webhooksRes = await call('/v1/notifications/webhooks')
  const webhooks = (webhooksRes.body?.webhooks ?? []).map((hook: { id?: string; url?: string; event_types?: { name?: string }[] }) => ({
    id: hook.id,
    url: hook.url,
    events: (hook.event_types ?? []).map(event => event.name),
    receives_activated: (hook.event_types ?? []).some(event => event.name === 'BILLING.SUBSCRIPTION.ACTIVATED' || event.name === '*'),
    points_to_scence_route: typeof hook.url === 'string' && hook.url.endsWith('/api/paypal/webhook'),
  }))

  const planRes = config.pro_plan_id ? await call(`/v1/billing/plans/${encodeURIComponent(config.pro_plan_id)}`) : null
  const plan = planRes?.ok
    ? { id: planRes.body?.id, name: planRes.body?.name, status: planRes.body?.status, product_id: planRes.body?.product_id }
    : { error: planRes ? `PayPal respondió ${planRes.status}` : 'No hay plan configurado' }

  const { data: rows } = await admin
    .from('subscriptions')
    .select('id, status, paypal_subscription_id, created_at, metadata')
    .not('paypal_subscription_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(25)

  const subscriptions = []
  for (const row of rows ?? []) {
    const detail = await call(`/v1/billing/subscriptions/${encodeURIComponent(row.paypal_subscription_id as string)}`)
    subscriptions.push({
      paypal_subscription_id: row.paypal_subscription_id,
      status_en_scence: row.status,
      status_en_paypal: detail.ok ? detail.body?.status : `error ${detail.status}`,
      plan_en_paypal: detail.ok ? detail.body?.plan_id : null,
      custom_id: detail.ok ? detail.body?.custom_id : null,
      custom_id_parseable: detail.ok ? Boolean(parseInfluencerReference(detail.body?.custom_id)) : null,
      creada: row.created_at,
      // Desincronizada = PayPal dice una cosa y SCENCE otra. Señal directa de
      // que el webhook no está llegando.
      desincronizada: detail.ok
        ? (detail.body?.status === 'ACTIVE' && row.status !== 'active')
        : null,
    })
  }

  return NextResponse.json({ config, webhooks, plan, subscriptions })
}
