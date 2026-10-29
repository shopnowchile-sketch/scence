// Qué evidencia se pide al entregar cada tipo de contenido. Fuente única para la UI de la influencer
// (campaña y "Mis entregables") y para POST /api/influencer/deliverables/[id]/submit.
//
// Story: la influencer NO entrega el enlace de Instagram (las stories expiran); entrega una carpeta/archivo
// público de Google Drive con la captura de sus estadísticas. El resto de los tipos sigue entregando el link
// del contenido publicado.
export type SubmissionRule = {
  label: string
  placeholder: string
  hint: string | null
  requiresPublicDrive: boolean
}

const DEFAULT_RULE: SubmissionRule = {
  label: 'Link del reel / contenido',
  placeholder: 'https://www.instagram.com/reel/…',
  hint: null,
  requiresPublicDrive: false,
}

const STORY_RULE: SubmissionRule = {
  label: 'URL pública de Google Drive con la captura de estadísticas',
  placeholder: 'https://drive.google.com/…',
  hint: 'Sube a Drive la captura de las estadísticas de esta story, déjala con acceso público (cualquiera con el enlace) y pega aquí ese enlace. No uses el enlace de la story de Instagram.',
  requiresPublicDrive: true,
}

export const submissionRuleFor = (type: string | null | undefined): SubmissionRule =>
  type === 'story' ? STORY_RULE : DEFAULT_RULE

const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com'])

export function isGoogleDriveUrl(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && DRIVE_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Mensaje de error si la URL no cumple la regla del tipo; null si es válida. */
export function validateSubmissionUrl(type: string | null | undefined, value: string | null | undefined): string | null {
  if (submissionRuleFor(type).requiresPublicDrive && !isGoogleDriveUrl(value)) {
    return 'Para una story entrega la URL pública de Google Drive con la captura de tus estadísticas (no el enlace de Instagram).'
  }
  return null
}
