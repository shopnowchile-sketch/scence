'use client'

import { useEffect, useState } from 'react'

/**
 * Igual que useState, pero persiste el valor en localStorage bajo `key`.
 * Pedido por Pri: la selección de columnas visibles en las tablas de admin
 * se perdía cada vez que se recargaba o navegaba (siempre volvía al default).
 *
 * SSR-safe: en el primer render del servidor usa `initialValue`; en el
 * cliente, tras montar, lee localStorage y actualiza si hay un valor guardado.
 */
export function useLocalStorageState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue)
  const [hydrated, setHydrated] = useState(false)

  // Leer de localStorage una vez montado en el cliente
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) {
        const parsed = JSON.parse(raw)
        const isPlainObject = (v: unknown) =>
          v !== null && typeof v === 'object' && !Array.isArray(v)
        // Si tanto el default como lo guardado son objetos (ej. columnas
        // visibles), se mezclan en vez de reemplazar — así una columna nueva
        // agregada después (con su default en `initialValue`) no queda
        // "perdida" solo porque el localStorage viejo no la conocía.
        setValue(
          isPlainObject(parsed) && isPlainObject(initialValue)
            ? { ...(initialValue as object), ...(parsed as object) } as T
            : parsed
        )
      }
    } catch {
      // localStorage no disponible o JSON inválido — seguir con el default
    }
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Guardar cada vez que cambie (una vez ya hidratado, para no pisar con el default)
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // localStorage lleno o no disponible — no bloquear la UI
    }
  }, [key, value, hydrated])

  return [value, setValue] as const
}
