import crypto from 'node:crypto'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://scence-app.vercel.app'
const STATE_SECRET = process.env.META_INSTAGRAM_STATE_SECRET

export const META_INSTAGRAM_CALLBACK_URL = `${APP_URL}/api/brand/instagram/callback`

export function getMetaInstagramConfig() {
  const appId = process.env.META_INSTAGRAM_APP_ID
  const appSecret = process.env.META_INSTAGRAM_APP_SECRET
  if (!appId || !appSecret || !STATE_SECRET) return null
  return { appId, appSecret, stateSecret: STATE_SECRET }
}

export function signInstagramState(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

export function isValidInstagramState(payload: string, signature: string, secret: string) {
  const expected = signInstagramState(payload, secret)
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function normalizeInstagramHandle(value: string) {
  return value.trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, '')
    .replace(/\/$/, '')
    .toLowerCase()
}
