import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ensureInfluencerRow } from '@/lib/supabase/ensureOrg'
import { InfluencerSidebar } from './_components/InfluencerSidebar'
import { PresenceHeartbeat } from './_components/PresenceHeartbeat'
import { ProfileCompletionGate } from './_components/ProfileCompletionGate'

export const metadata: Metadata = {
  title: { default: 'Mi Portal — Scence', template: '%s | Scence' },
}

export const dynamic = 'force-dynamic'

// Perfil obligatorio (Instagram + comuna + dirección) — misma condición que
// isProfileComplete() en inf-profile/page.tsx y la validación server-side de
// PATCH /api/influencer/me. Se calcula acá (server, admin client, mismo
// patrón que /api/influencer/me) para no dejar pasar al resto del portal sin
// estos datos, incluyendo cuentas antiguas.
async function isInfluencerProfileComplete(userId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('influencers')
    .select('address, commune, influencer_social_profiles (platform, username)')
    .eq('user_id', userId)
    .single()
  if (!data) return true // no es cuenta influencer (ensureOrg ya validó rol) — no bloquear

  const hasAddress   = !!(data.address && String(data.address).trim())
  const hasCommune   = !!(data.commune && String(data.commune).trim())
  const hasInstagram = (data.influencer_social_profiles ?? []).some(
    (sp: { platform: string; username: string | null }) => sp.platform === 'instagram' && sp.username && sp.username.trim()
  )
  return hasAddress && hasCommune && hasInstagram
}

export default async function InfluencerLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // FIX (2026-07-02, seguimiento trigger): antes se llamaba ensureOrg(user)
  // acá, que era no-op mientras el trigger handle_new_user() stampeaba
  // organization_id en el metadata del usuario. Al corregir el trigger para
  // que ya no cree organizaciones huérfanas, ensureOrg() dejó de ser no-op y
  // volvía a crear una org basura (nombrada por dominio de email) en cada
  // login de influencer, además de pisar profiles.role de vuelta a
  // 'brand_manager'. Se remueve: ensureInfluencerRow() ya resuelve la
  // organización real (Scence SpA) por su cuenta y no depende de
  // organization_id en metadata.
  // FIX (B-18): auto-repara creadores auto-registrados que no tienen fila en
  // `influencers` (ver ensureInfluencerRow en ensureOrg.ts). No-op para
  // cuentas que ya tienen su fila.
  await ensureInfluencerRow(user)
  const profileComplete = await isInfluencerProfileComplete(user.id)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <PresenceHeartbeat />
      <InfluencerSidebar />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="p-4 lg:p-6 max-w-[1200px] mx-auto">
          <ProfileCompletionGate complete={profileComplete}>
            {children}
          </ProfileCompletionGate>
        </div>
      </main>
    </div>
  )
}
