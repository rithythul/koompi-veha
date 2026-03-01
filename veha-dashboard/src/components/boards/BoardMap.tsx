import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Board, Zone } from '../../types/api'
import { formatRelativeTime } from '../../lib/utils'
import { useThemeStore } from '../../stores/theme'

interface BoardMapProps {
  boards: Board[]
  zones: Zone[]
  onBoardClick: (id: string) => void
}

const statusColors: Record<string, string> = {
  online: '#34d399',
  offline: '#94a3b8',
  error: '#fb7185',
}

function createMarkerIcon(status: string) {
  const color = statusColors[status] ?? statusColors.offline
  const svg = `
    <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="12" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="2"/>
      <circle cx="14" cy="14" r="5" fill="${color}"/>
    </svg>
  `
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

// Pre-create icons for known statuses to avoid re-creating on every render
const markerIcons: Record<string, L.DivIcon> = {
  online: createMarkerIcon('online'),
  offline: createMarkerIcon('offline'),
  error: createMarkerIcon('error'),
}

function getMarkerIcon(status: string): L.DivIcon {
  return markerIcons[status] ?? markerIcons.offline
}

const PHNOM_PENH_CENTER: [number, number] = [11.55, 104.92]
const DEFAULT_ZOOM = 12

const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

export function BoardMap({ boards, zones, onBoardClick }: BoardMapProps) {
  const theme = useThemeStore((s) => s.theme)
  const zoneMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const z of zones) {
      map.set(z.id, z.name)
    }
    return map
  }, [zones])

  const mappableBoards = useMemo(
    () => boards.filter((b) => b.latitude != null && b.longitude != null),
    [boards],
  )

  return (
    <div className="w-full h-[calc(100vh-260px)] min-h-[400px] rounded-lg overflow-hidden border border-border-default">
      <MapContainer
        center={PHNOM_PENH_CENTER}
        zoom={DEFAULT_ZOOM}
        className="w-full h-full"
        scrollWheelZoom={true}
      >
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url={theme === 'dark' ? TILE_DARK : TILE_LIGHT}
        />
        {mappableBoards.map((board) => (
          <Marker
            key={board.id}
            position={[board.latitude!, board.longitude!]}
            icon={getMarkerIcon(board.status)}
            eventHandlers={{
              click: () => onBoardClick(board.id),
            }}
          >
            <Popup>
              <div className="min-w-[180px]">
                <p className="text-sm font-semibold mb-1">{board.name}</p>
                <div className="space-y-0.5 text-xs">
                  <p>
                    <span className="text-text-muted">Status: </span>
                    <span
                      className="font-medium capitalize"
                      style={{ color: statusColors[board.status] ?? statusColors.offline }}
                    >
                      {board.status}
                    </span>
                  </p>
                  <p>
                    <span className="text-text-muted">Zone: </span>
                    <span>{board.zone_id ? zoneMap.get(board.zone_id) ?? '--' : '--'}</span>
                  </p>
                  <p>
                    <span className="text-text-muted">Last seen: </span>
                    <span>{formatRelativeTime(board.last_seen)}</span>
                  </p>
                  {board.address && (
                    <p>
                      <span className="text-text-muted">Address: </span>
                      <span>{board.address}</span>
                    </p>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
