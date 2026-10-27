'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo } from 'react'
import { ERROR_FRAGMENTS, ES_TO_EN, ES_TO_EN_PATTERNS, SPANISH_MONTHS } from '@/i18n/catalog'
import {
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  type AppLocale,
} from '@/i18n/config'

interface LocaleContextValue {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const
const MONTH_REPLACEMENTS = Object.entries(SPANISH_MONTHS).map(([spanish, english]) => ({
  pattern: new RegExp(`\\b${spanish}\\b`, 'gi'),
  english,
}))
const ERROR_REPLACEMENTS = ERROR_FRAGMENTS.map(([spanish, english]) => ({
  pattern: new RegExp(`\\b${spanish}\\b`, 'gi'),
  english,
}))

function translateText(value: string): string {
  const leading = value.match(/^\s*/)?.[0] ?? ''
  const trailing = value.match(/\s*$/)?.[0] ?? ''
  const clean = value.trim()
  if (!clean) return value

  const exact = ES_TO_EN[clean]
  if (exact) return `${leading}${exact}${trailing}`

  for (const [pattern, replacement] of ES_TO_EN_PATTERNS) {
    if (pattern.test(clean)) return `${leading}${clean.replace(pattern, replacement)}${trailing}`
  }

  if (/^(Error|No se pudo|No pudimos|.+ (?:es|son) obligatori|.+ inv[aá]lid|.+ no encontr)/i.test(clean)) {
    let errorTranslation = clean
    for (const { pattern, english } of ERROR_REPLACEMENTS) {
      errorTranslation = errorTranslation.replace(pattern, english)
    }
    if (errorTranslation !== clean) return `${leading}${errorTranslation}${trailing}`
  }

  let translated = clean
  for (const { pattern, english } of MONTH_REPLACEMENTS) {
    translated = translated.replace(pattern, match => {
      const result = english
      return match[0] === match[0].toUpperCase() ? result.toUpperCase() : result
    })
  }
  return translated === clean ? value : `${leading}${translated}${trailing}`
}

function shouldSkip(node: Node): boolean {
  const parent = node.parentElement
  return Boolean(parent?.closest('script, style, textarea, [contenteditable="true"], [data-no-translate]'))
}

function translateNode(root: Node) {
  if (root.nodeType === Node.TEXT_NODE && !shouldSkip(root)) {
    const current = root.textContent ?? ''
    const translated = translateText(current)
    if (translated !== current) root.textContent = translated
    return
  }

  if (!(root instanceof Element) && !(root instanceof Document)) return

  if (root instanceof Element && !root.closest('[data-no-translate]')) {
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const current = root.getAttribute(attribute)
      if (!current) continue
      const translated = translateText(current)
      if (translated !== current) root.setAttribute(attribute, translated)
    }
    if (root instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(root.type)) {
      root.value = translateText(root.value)
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let current = walker.nextNode()
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      if (!shouldSkip(current)) {
        const value = current.textContent ?? ''
        const translated = translateText(value)
        if (translated !== value) current.textContent = translated
      }
    } else if (current instanceof Element && !current.closest('[data-no-translate]')) {
      for (const attribute of TRANSLATABLE_ATTRIBUTES) {
        const value = current.getAttribute(attribute)
        if (!value) continue
        const translated = translateText(value)
        if (translated !== value) current.setAttribute(attribute, translated)
      }
    }
    current = walker.nextNode()
  }
}


/** Ejecuta `run` cuando la hidratación de React ya terminó: tras `load`, dos fotogramas y un instante de reposo.
 * Tope de 1,5 s para no dejar el cuerpo oculto si algo se retrasa. Devuelve la función que cancela la espera. */
function afterHydration(run: () => void): () => void {
  let done = false
  let capTimer: number | undefined
  const fire = () => {
    if (done) return
    done = true
    window.clearTimeout(capTimer)
    run()
  }
  const settle = () => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (done) return
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fire, { timeout: 500 })
      else window.setTimeout(fire, 0)
    }))
  }
  capTimer = window.setTimeout(fire, 1500)
  if (document.readyState === 'complete') settle()
  else window.addEventListener('load', settle, { once: true })
  return () => {
    done = true
    window.clearTimeout(capTimer)
    window.removeEventListener('load', settle)
  }
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale
  children: React.ReactNode
}) {
  const setLocale = useCallback((locale: AppLocale) => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)

    // Reuse the existing profile preference. Public users simply keep the
    // cookie/localStorage choice; authenticated users also retain it across devices.
    void fetch('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
      keepalive: true,
    }).catch(() => undefined)

    window.location.reload()
  }, [])

  useLayoutEffect(() => {
    document.documentElement.lang = initialLocale
    document.documentElement.dataset.locale = initialLocale
    if (initialLocale !== 'en') document.documentElement.dataset.localeReady = 'true'
  }, [initialLocale])

  // La traducción al inglés reescribe nodos de texto del DOM. Hacerlo mientras React hidrata (sobre todo dentro
  // de límites Suspense) provoca los errores #425/#422. Por eso se espera a que la hidratación termine; mientras
  // tanto el cuerpo sigue oculto (globals.css), así que la experiencia visual no cambia.
  useEffect(() => {
    if (initialLocale !== 'en') return
    let observer: MutationObserver | undefined
    const stopWaiting = afterHydration(() => {
      translateNode(document.body)
      const [pageTitle, suffix] = document.title.split(' · ')
      const translatedTitle = translateText(pageTitle)
      document.title = suffix ? `${translatedTitle} · ${suffix}` : translatedTitle
      document.documentElement.dataset.localeReady = 'true'

      const options = {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
      }
      observer = new MutationObserver(mutations => {
        observer?.disconnect()
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') translateNode(mutation.target)
          for (const node of Array.from(mutation.addedNodes)) translateNode(node)
          if (mutation.type === 'attributes') translateNode(mutation.target)
        }
        observer?.observe(document.body, options)
      })
      observer.observe(document.body, options)
    })
    return () => {
      stopWaiting()
      observer?.disconnect()
    }
  }, [initialLocale])

  const value = useMemo(() => ({ locale: initialLocale, setLocale }), [initialLocale, setLocale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useScenceLocale() {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('useScenceLocale must be used inside LocaleProvider')
  return context
}
