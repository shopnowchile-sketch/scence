'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import { Loader2, MapPin } from 'lucide-react'

export type NormalizedBrandAddress = {
  street: string
  number: string
  commune: string
  region: string
  country: string
  countryCode: string
  placeId: string
  lat: number | null
  lng: number | null
}

type Props = {
  countryCode: string
  value: string
  onChange: (value: string) => void
  onSelect: (address: NormalizedBrandAddress) => void
}

let mapsLoader: Loader | null = null
function getLoader() {
  if (!mapsLoader) mapsLoader = new Loader({
    apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '', version: 'weekly', libraries: ['places'],
  })
  return mapsLoader
}

function part(components: google.maps.GeocoderAddressComponent[], ...types: string[]) {
  return components.find(c => types.some(type => c.types.includes(type)))?.long_name ?? ''
}

/** Busca una dirección real y devuelve sus componentes normalizados por Google Maps. */
export function GooglePlacesAddress({ countryCode, value, onChange, onSelect }: Props) {
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([])
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null)
  const geocoderRef = useRef<google.maps.Geocoder | null>(null)

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) return
    getLoader().load().then(() => {
      serviceRef.current = new google.maps.places.AutocompleteService()
      geocoderRef.current = new google.maps.Geocoder()
      setReady(true)
    }).catch(() => setReady(false))
  }, [])

  function search(input: string) {
    onChange(input)
    if (!serviceRef.current || input.trim().length < 3) { setPredictions([]); return }
    serviceRef.current.getPlacePredictions({ input, componentRestrictions: countryCode ? { country: countryCode } : undefined }, (results, status) => {
      setPredictions(status === google.maps.places.PlacesServiceStatus.OK ? (results ?? []) : [])
    })
  }

  function choose(placeId: string, description: string) {
    if (!geocoderRef.current) return
    setLoading(true)
    setPredictions([])
    geocoderRef.current.geocode({ placeId }, (results, status) => {
      setLoading(false)
      if (status !== 'OK' || !results?.[0]) return
      const result = results[0]
      const components = result.address_components
      const country = components.find(c => c.types.includes('country'))
      onChange(result.formatted_address || description)
      onSelect({
        street: part(components, 'route'),
        number: part(components, 'street_number'),
        commune: part(components, 'administrative_area_level_3', 'locality', 'postal_town', 'administrative_area_level_2'),
        region: part(components, 'administrative_area_level_1'),
        country: country?.long_name ?? '', countryCode: country?.short_name ?? countryCode,
        placeId: result.place_id ?? placeId,
        lat: result.geometry?.location.lat() ?? null, lng: result.geometry?.location.lng() ?? null,
      })
    })
  }

  return <div className="relative">
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
      <input value={value} onChange={e => search(e.target.value)} disabled={!ready || !countryCode}
        placeholder={countryCode ? 'Busca y selecciona la dirección en Google Maps' : 'Selecciona primero el país'}
        className="input-base w-full pl-9" />
      {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-violet-500" />}
    </div>
    {!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && <p className="text-xs text-amber-600 mt-1">Falta configurar Google Maps para buscar direcciones.</p>}
    {predictions.length > 0 && <ul className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
      {predictions.map(p => <li key={p.place_id}><button type="button" onClick={() => choose(p.place_id, p.description)} className="w-full text-left px-3 py-2.5 text-sm hover:bg-violet-50">
        {p.description}
      </button></li>)}
    </ul>}
  </div>
}
