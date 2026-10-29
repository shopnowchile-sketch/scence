// La URL del perfil se deriva siempre del usuario: la influencer solo escribe su @.
const URL_TEMPLATES: Record<string, (handle: string) => string> = {
  instagram: h => `https://www.instagram.com/${h}`,
  tiktok: h => `https://www.tiktok.com/@${h}`,
  youtube: h => `https://www.youtube.com/@${h}`,
  twitter: h => `https://x.com/${h}`,
  facebook: h => `https://www.facebook.com/${h}`,
  linkedin: h => `https://www.linkedin.com/in/${h}`,
  pinterest: h => `https://www.pinterest.com/${h}`,
  twitch: h => `https://www.twitch.tv/${h}`,
}

/** URL pública del perfil a partir de plataforma + usuario; null si no se puede derivar. */
export function socialProfileUrl(platform: unknown, username: unknown): string | null {
  const handle = String(username ?? '').trim().replace(/^@/, '').replace(/[^\w.-]/g, '')
  const build = typeof platform === 'string' ? URL_TEMPLATES[platform] : undefined
  return handle && build ? build(handle) : null
}
