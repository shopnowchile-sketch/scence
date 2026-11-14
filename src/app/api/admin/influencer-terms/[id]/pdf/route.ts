import { NextRequest, NextResponse } from 'next/server'
import { jsPDF } from 'jspdf'
import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { getOrgId, getUserRole } from '@/lib/supabase/ensureOrg'

export const runtime = 'nodejs'

function buildPdf(title: string, version: string, acceptedAt: string, content: string, influencerName: string) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('SCENCE', 20, 24)
  doc.setFontSize(13)
  doc.text(title, 20, 34)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 100, 100)
  doc.text('Versión ' + version + ' · Aceptado por ' + influencerName, 20, 41)
  doc.text(new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(acceptedAt)), 20, 47)
  doc.setTextColor(0, 0, 0)

  const lines = doc.splitTextToSize(content, 170)
  let y = 60
  doc.setFontSize(9)
  for (const line of lines) {
    if (y > 280) {
      doc.addPage()
      y = 20
    }
    doc.text(line, 20, y)
    y += 4.4
  }
  return doc.output('arraybuffer')
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const orgId = await getOrgId(user.id, user.user_metadata, admin)
  const { isAdmin } = orgId ? await getUserRole(user.id, orgId, admin) : { isAdmin: false }
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: acceptance } = await admin
    .from('influencer_terms_acceptances')
    .select('id, document_title, document_version, content_snapshot, accepted_at, influencer_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!acceptance) return NextResponse.json({ error: 'Términos no encontrados.' }, { status: 404 })

  const { data: influencer } = await admin
    .from('influencers')
    .select('display_name, organization_id')
    .eq('id', acceptance.influencer_id)
    .maybeSingle()
  if (!influencer || influencer.organization_id !== orgId) return NextResponse.json({ error: 'Términos no encontrados.' }, { status: 404 })

  const pdf = buildPdf(acceptance.document_title, acceptance.document_version, acceptance.accepted_at, acceptance.content_snapshot, influencer.display_name)
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="scence-terms-' + acceptance.document_version.replace(/[^a-z0-9.-]/gi, '-') + '.pdf"',
      'Cache-Control': 'private, no-store',
    },
  })
}
