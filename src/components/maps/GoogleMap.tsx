'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import { MapPin, ExternalLink, Navigation } from 'lucide-react'
import { buildGoogleMapsLink } from '@/lib/utils'

interface MapProps {
  address?: string
  lat?: number
  lng?: number
  placeId?: string
  zoom?: number
  height?: string
  showDirectionsButton?: boolean
  className?: string
}

let loader: Loader | null = null

function getLoader() {
  if (!loader) {
    loader = new Loader({
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
      version: 'weekly',
      libraries: ['places', 'marker'],
    })
  }
  return loader
}

export function GoogleMap({
  address,
  lat,
  lng,
  placeId,
  zoom = 15,
  height = '240px',
  showDirectionsButton = true,
  className = '',
}: MapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!mapRef.current) return
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
      setError('Google Maps API key no configurada')
      return
    }

    getLoader()
      .load()
      .then(async (google) => {
        const { Map } = await google.maps.importLibrary('maps') as google.maps.MapsLibrary
        const { AdvancedMarkerElement } = await google.maps.importLibrary('marker') as google.maps.MarkerLibrary

        let center: google.maps.LatLngLiteral = { lat: lat ?? 19.4326, lng: lng ?? -99.1332 }

        const map = new Map(mapRef.current!, {
          center,
          zoom,
          mapId: 'SCENCE_MAP',
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
          ],
        })

        // Si solo tenemos address o placeId, usar Geocoder
        if (!lat && !lng && (address || placeId)) {
          const geocoder = new google.maps.Geocoder()
          const request = placeId
            ? { placeId }
            : { address: address! }

          geocoder.geocode(request, (results, status) => {
            if (status === 'OK' && results?.[0]) {
              const location = results[0].geometry.location
              center = { lat: location.lat(), lng: location.lng() }
              map.setCenter(center)
              new AdvancedMarkerElement({ map, position: center, title: address })
            } else {
              setError('Dirección no encontrada')
            }
          })
        } else if (lat && lng) {
          new AdvancedMarkerElement({ map, position: { lat, lng }, title: address })
        }

        setLoaded(true)
      })
      .catch(e => setError('Error cargando Google Maps'))
  }, [address, lat, lng, placeId, zoom])

  if (error) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 bg-gray-50 rounded-xl border border-gray-200 text-gray-400 ${className}`}
        style={{ height }}
      >
        <MapPin className="h-6 w-6" />
        <span className="text-xs">{error}</span>
        {address && (
          <a
            href={buildGoogleMapsLink(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-600 hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" /> Ver en Google Maps
          </a>
        )}
      </div>
    )
  }

  return (
    <div className={`relative rounded-xl overflow-hidden border border-gray-200 ${className}`} style={{ height }}>
      <div ref={mapRef} className="w-full h-full" />

      {/* Botón de navegación */}
      {showDirectionsButton && address && (
        <a
          href={buildGoogleMapsLink(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-md text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors border border-gray-200"
        >
          <Navigation className="h-3.5 w-3.5 text-violet-600" />
          Cómo llegar
        </a>
      )}

      {/* Loading overlay */}
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
          <div className="animate-pulse flex flex-col items-center gap-2">
            <MapPin className="h-6 w-6 text-gray-300" />
            <span className="text-xs text-gray-400">Cargando mapa...</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente simplificado para dirección con mapa inline ──
interface AddressWithMapProps {
  address: string
  label?: string
  showMap?: boolean
}

export function AddressWithMap({ address, label, showMap = true }: AddressWithMapProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-2">
      {label && <div className="text-xs font-medium text-gray-500">{label}</div>}
      <div className="flex items-start gap-2">
        <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-gray-700">{address}</span>
          <div className="flex items-center gap-2 mt-1">
            <a
              href={buildGoogleMapsLink(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-violet-600 hover:underline flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" /> Abrir en Maps
            </a>
            {showMap && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {expanded ? 'Ocultar mapa' : 'Ver mapa'}
              </button>
            )}
          </div>
        </div>
      </div>
      {showMap && expanded && (
        <GoogleMap address={address} height="200px" className="mt-2" />
      )}
    </div>
  )
}
