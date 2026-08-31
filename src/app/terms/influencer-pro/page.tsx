import Link from 'next/link'
import { INFLUENCER_PRO_TERMS } from '@/lib/influencer-pro-terms'

export default function InfluencerProTermsPage() {
  return <main className="min-h-screen bg-gray-50 px-4 py-10"><article className="mx-auto max-w-3xl rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-10">
    <Link href="/inf-profile?tab=plan" className="text-sm font-semibold text-violet-600 hover:underline">← Volver a Mi Plan</Link>
    <h1 className="mt-6 text-3xl font-bold text-gray-900">{INFLUENCER_PRO_TERMS.title}</h1>
    <p className="mt-2 text-sm text-gray-500">Versión {INFLUENCER_PRO_TERMS.version} · Vigente desde {INFLUENCER_PRO_TERMS.effectiveDate}</p>
    <div className="mt-8 space-y-7">{INFLUENCER_PRO_TERMS.sections.map(section => <section key={section.title}><h2 className="text-lg font-bold text-gray-900">{section.title}</h2><p className="mt-2 whitespace-pre-line text-sm leading-7 text-gray-600">{section.body}</p></section>)}</div>
  </article></main>
}
