import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ADMIN_NOTIFICATION_EMAIL, FROM_EMAIL, getResend } from '@/lib/resend'

export const OWNED_BRAND_BUCKET = 'influencer-brand-logos'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const APPROVAL_EMAIL = ADMIN_NOTIFICATION_EMAIL

export async function getInfluencer(user: User, admin: SupabaseClient) {
  const { data } = await admin.from('influencers').select('id, display_name, email').eq('user_id', user.id).maybeSingle()
  return data
}

export async function uploadOwnedBrandLogo(admin: SupabaseClient, userId: string, file: File) {
  if (!file.type.startsWith('image/')) throw new Error('El logo debe ser una imagen')
  if (file.size > 5 * 1024 * 1024) throw new Error('El logo no puede superar 5 MB')
  const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'img'
  const path = `${userId}/${crypto.randomUUID()}.${extension}`
  const { error } = await admin.storage.from(OWNED_BRAND_BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return { path, url: admin.storage.from(OWNED_BRAND_BUCKET).getPublicUrl(path).data.publicUrl }
}

export function formText(form: FormData, key: string) {
  return String(form.get(key) ?? '').trim() || null
}

function esc(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export async function notifyBrandReferral(input: { brandId: string; brandName: string; contactName: string | null; contactEmail: string | null; influencerName: string; influencerEmail: string | null }) {
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:32px 16px"><div style="max-width:560px;margin:auto;background:white;border-radius:16px;overflow:hidden"><div style="background:#7c3aed;color:white;padding:24px;text-align:center;font-size:20px;font-weight:800">SCENCE</div><div style="padding:28px"><h1 style="font-size:21px">Nueva marca pendiente de aprobación</h1><p>La influencer <strong>${esc(input.influencerName)}</strong>${input.influencerEmail ? ` (${esc(input.influencerEmail)})` : ''} agregó una marca.</p><div style="background:#f9fafb;padding:16px;border-radius:10px;line-height:1.7"><strong>Marca:</strong> ${esc(input.brandName)}<br><strong>Contacto:</strong> ${esc(input.contactName ?? 'Sin nombre')}<br><strong>Email:</strong> ${esc(input.contactEmail ?? 'Sin email')}</div><a href="${APP_URL}/admin-brands/${input.brandId}" style="display:block;margin-top:24px;background:#7c3aed;color:white;text-align:center;padding:13px;border-radius:10px;text-decoration:none;font-weight:600">Revisar y aprobar →</a></div></div></body></html>`
  const { error } = await getResend().emails.send({ from: FROM_EMAIL, to: APPROVAL_EMAIL, subject: `[Scence] Nueva marca para aprobar: ${input.brandName}`, html })
  if (error) throw new Error(error.message)
}
