import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'
import { generateSubscriptionReceiptPdf } from '@/lib/subscription-receipt-pdf'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: payment, error: paymentError } = await admin
    .from('subscription_payments')
    .select('id, influencer_id, payer_type, gateway, gateway_payment_id, amount, currency, status, paid_at, period_start, period_end, receipt_url')
    .eq('id', params.id)
    .eq('payer_type', 'influencer')
    .maybeSingle()

  if (paymentError) return NextResponse.json({ error: 'No se pudo consultar el pago.' }, { status: 500 })
  if (!payment?.influencer_id) return NextResponse.json({ error: 'Comprobante no encontrado.' }, { status: 404 })

  const { data: influencer } = await admin
    .from('influencers')
    .select('display_name, email')
    .eq('id', payment.influencer_id)
    .maybeSingle()

  if (!influencer) return NextResponse.json({ error: 'Influencer no encontrada.' }, { status: 404 })

  const { data: termsAcceptance } = await admin
    .from('influencer_terms_acceptances')
    .select('document_version, status, accepted_at')
    .eq('influencer_id', payment.influencer_id)
    .eq('document_key', 'influencer_pro_terms')
    .eq('document_version', '2.0')
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const pdf = generateSubscriptionReceiptPdf({
    influencerName: influencer.display_name,
    influencerEmail: influencer.email,
    paymentDate: payment.paid_at,
    periodStart: payment.period_start,
    periodEnd: payment.period_end,
    amount: payment.amount,
    currency: payment.currency,
    gateway: payment.gateway,
    gatewayPaymentId: payment.gateway_payment_id,
    status: payment.status,
    receiptUrl: payment.receipt_url,
    termsAcceptedAt: termsAcceptance?.accepted_at ?? null,
  })

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="scence-pro-${params.id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
