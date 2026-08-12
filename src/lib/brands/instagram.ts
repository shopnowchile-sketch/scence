/** Canonical Instagram key used to find an existing commercial brand. */
export function normalizeInstagramHandle(value: unknown): string | null {
  let handle = String(value ?? '').trim()
  if (!handle) return null
  try {
    if (/^https?:\/\//i.test(handle)) {
      const url = new URL(handle)
      if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null
      handle = url.pathname.split('/').filter(Boolean)[0] ?? ''
    }
  } catch { return null }
  handle = handle.replace(/^@/, '').replace(/\/$/, '').toLowerCase()
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null
}
