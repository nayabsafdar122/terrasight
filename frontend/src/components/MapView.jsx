import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON, Marker, Tooltip, Polyline, Polygon, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import L from 'leaflet'

function ClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)) })
  return null
}

function FlyTo({ target, bbox }) {
  const map = useMap()
  useEffect(() => { window.__terrasightMap = map }, [map]) // handy for demos & e2e tests
  useEffect(() => {
    if (bbox) map.fitBounds([[bbox.min_lat, bbox.min_lng], [bbox.max_lat, bbox.max_lng]], { padding: [24, 24] })
  }, [bbox, map])
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.z || 11, { duration: 1.1 })
  }, [target, map])
  return null
}

const hotspotIcon = (h) => L.divIcon({
  className: '',
  html: `<div class="hs-marker" style="--s:${Math.min(70, 26 + h.cells * 1.6)}px"><span class="hs-ring"></span><span class="hs-core">${String.fromCharCode(64 + h.rank)}</span></div>`,
  iconSize: [0, 0],
})

const siteIcon = (s) => L.divIcon({
  className: '',
  html: `<div class="site-marker"><span>${s.priority}</span></div>`,
  iconSize: [0, 0],
})

const labelIcon = (name) => L.divIcon({
  className: '',
  html: `<div class="city-label"><span class="city-dot"></span>${name}</div>`,
  iconSize: [0, 0],
})

const pinIcon = L.divIcon({
  className: '',
  html: '<div class="pin"><div class="pin-dot"></div></div>',
  iconSize: [0, 0],
})

export default function MapView({ meta, grid, hotspots, sites, layers, selected, onClick, flyTo }) {
  // new key per grid response forces Leaflet to redraw the choropleth
  const gridKey = useMemo(() => Math.random().toString(36), [grid])

  const style = (f) => ({
    fillColor: f.properties.color,
    fillOpacity: 0.18 + f.properties.risk * 0.55,
    color: f.properties.color,
    weight: 0.6,
    opacity: 0.55,
  })

  const onEach = (f, layer) => {
    const p = f.properties
    layer.bindTooltip(
      `<div class="tt"><div class="tt-h"><b>${(p.risk * 100).toFixed(0)}%</b> <span style="color:${p.color}">${p.band}</span></div>
       <div>Elevation ${p.elevation_m} m · NDVI ${p.ndvi}</div>
       <div>${p.temperature_c}°C · RH ${p.humidity_pct}% · Wind ${p.wind_kmh} km/h</div></div>`,
      { sticky: true, direction: 'top', className: 'tt-wrap', opacity: 1 }
    )
    layer.on({
      mouseover: (e) => e.target.setStyle({ weight: 2, color: '#ffffff', opacity: 0.9 }),
      mouseout: (e) => e.target.setStyle(style(f)),
    })
  }

  return (
    <MapContainer
      center={meta?.center || [34.12, -118.15]} zoom={9} minZoom={7} maxZoom={15}
      zoomControl={false} zoomSnap={0.25} className="map" preferCanvas={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <ZoomControl position="bottomright" />

      {/* built-in vector context: works even if basemap tiles are blocked */}
      {meta?.coast && (
        <>
          <Polygon
            positions={[...meta.coast, [32.6, -116.4], [32.6, -120.2], [meta.coast[0][0], -120.2]]}
            pathOptions={{ stroke: false, fillColor: '#0b2a4a', fillOpacity: 0.35, interactive: false }}
          />
          <Polyline positions={meta.coast} pathOptions={{ color: '#38bdf8', weight: 6, opacity: 0.12, interactive: false }} />
          <Polyline positions={meta.coast} pathOptions={{ color: '#7dd3fc', weight: 1.4, opacity: 0.8, interactive: false }} />
        </>
      )}
      <ClickHandler onClick={onClick} />
      <FlyTo target={flyTo} bbox={meta?.bbox} />

      {layers.risk && grid && <GeoJSON key={gridKey} data={grid} style={style} onEachFeature={onEach} />}

      {layers.hotspots && hotspots.map((h) => (
        <Marker key={`h${h.id}-${h.rank}`} position={[h.lat, h.lng]} icon={hotspotIcon(h)}
          eventHandlers={{ click: () => onClick(h.lat, h.lng) }}>
          <Tooltip direction="top" className="tt-wrap" opacity={1}>
            <div className="tt"><div className="tt-h"><b>{h.name}</b></div>
              <div>{h.area_km2} km² · mean risk {(h.mean_risk * 100).toFixed(0)}%</div></div>
          </Tooltip>
        </Marker>
      ))}

      {layers.resources && sites.map((s) => (
        <Marker key={`s${s.id}-${s.priority}`} position={[s.lat, s.lng]} icon={siteIcon(s)}>
          <Tooltip direction="top" className="tt-wrap" opacity={1}>
            <div className="tt"><div className="tt-h"><b>Staging site #{s.priority}</b></div>
              <div>Near {s.near} · covers {s.share_pct}% of risk</div>
              <div>Avg. response distance {s.avg_response_km} km</div></div>
          </Tooltip>
        </Marker>
      ))}

      {meta?.places.map((p) => (
        <Marker key={p.name} position={[p.lat, p.lng]} icon={labelIcon(p.name)} interactive={false} zIndexOffset={-500} />
      ))}

      {selected && <Marker position={[selected.lat, selected.lng]} icon={pinIcon} />}
    </MapContainer>
  )
}
