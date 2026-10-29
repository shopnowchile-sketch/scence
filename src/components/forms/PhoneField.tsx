'use client'

// Teléfono internacional: país (bandera + prefijo) y número por separado.
// Emite siempre E.164 ("+56912345678") cuando el número es válido para el país.
import { useState } from 'react'
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, formatNational, phoneCountry, phoneCountryFlag, splitStoredPhone, toE164 } from '@/lib/phone'

type Props = {
  label?: string
  /** Valor guardado (E.164 o formato antiguo). */
  value: string
  /** `value` = E.164 válido o '' ; `error` = mensaje en español si el número no es válido. */
  onChange: (value: string, error: string | null) => void
  required?: boolean
}

export function PhoneField({ label = 'Teléfono', value, onChange, required }: Props) {
  const stored = splitStoredPhone(value)
  const [iso, setIso] = useState(stored?.iso ?? DEFAULT_PHONE_COUNTRY)
  const [national, setNational] = useState(stored ? formatNational(stored.national, stored.iso) : value ?? '')
  const [touched, setTouched] = useState(false)
  const country = phoneCountry(iso)

  const parsed = national.trim() ? toE164(national, iso) : null
  const error = touched && parsed && !parsed.ok ? parsed.error : null

  function emit(nextIso: string, nextNational: string) {
    if (!nextNational.trim()) return onChange('', required ? 'Ingresa tu número de teléfono' : null)
    const result = toE164(nextNational, nextIso)
    onChange(result.ok ? result.e164 : value, result.ok ? null : result.error)
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}{required ? ' *' : ''}</label>
      <div className="flex gap-2">
        <select
          value={iso} aria-label="País del teléfono"
          onChange={e => { setIso(e.target.value); setNational(formatNational(national, e.target.value)); emit(e.target.value, national) }}
          className="w-[7.25rem] shrink-0 rounded-xl border border-gray-200 bg-gray-50 px-2 py-2 text-sm outline-none focus:border-violet-400"
        >
          {PHONE_COUNTRIES.map(c => <option key={c.iso} value={c.iso}>{phoneCountryFlag(c.iso)} +{c.dial}</option>)}
        </select>
        <input
          type="tel" inputMode="tel" autoComplete="tel-national" value={national}
          onChange={e => { const next = formatNational(e.target.value, iso); setNational(next); emit(iso, next) }}
          onBlur={() => setTouched(true)}
          placeholder={country.iso === 'CL' ? '9 1234 5678' : '…'}
          aria-invalid={Boolean(error)}
          className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
