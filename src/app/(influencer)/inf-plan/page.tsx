import { redirect } from 'next/navigation'

// Ruta legacy: el plan de la influencer vive en /inf-profile?tab=plan.
// Se mantiene como redirect por si quedan links antiguos (p. ej. retornos de
// PayPal); conserva los query params que traiga.
export default function InfluencerPlanPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'tab' || value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v)
  }
  params.set('tab', 'plan')
  redirect(`/inf-profile?${params.toString()}`)
}
