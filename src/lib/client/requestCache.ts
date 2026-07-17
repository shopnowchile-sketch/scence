'use client'

type CacheEntry = { expiresAt: number; promise: Promise<unknown> }

const globalCache = globalThis as typeof globalThis & {
  __scenceRequestCache?: Map<string, CacheEntry>
}

const cache = globalCache.__scenceRequestCache ?? new Map<string, CacheEntry>()
globalCache.__scenceRequestCache = cache

export function fetchJsonCached<T>(url: string, ttlMs = 30_000): Promise<T> {
  const current = cache.get(url)
  if (current && current.expiresAt > Date.now()) return current.promise as Promise<T>

  const promise = fetch(url)
    .then(async response => {
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return response.json() as Promise<T>
    })
    .catch(error => {
      cache.delete(url)
      throw error
    })

  cache.set(url, { expiresAt: Date.now() + ttlMs, promise })
  return promise
}

export function invalidateCachedJson(prefix: string) {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
