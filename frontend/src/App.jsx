import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Cpu, Flame, Hexagon } from 'lucide-react'
import { api } from './api'
import MapView from './components/MapView'
import ControlPanel from './components/ControlPanel'
import InsightPanel from './components/InsightPanel'

const ZERO = { temp_delta: 0, wind_delta: 0, humidity_delta: 0, drought: 0 }

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function App() {
  const [meta, setMeta] = useState(null)
  const [model, setModel] = useState(null)
  const [scenario, setScenario] = useState(ZERO)
  const [preset, setPreset] = useState('baseline')
  const [layers, setLayers] = useState({ risk: true, hotspots: true, resources: false })
  const [threshold, setThreshold] = useState(0.55)
  const [units, setUnits] = useState(6)

  const [grid, setGrid] = useState(null)
  const [stats, setStats] = useState(null)
  const [hotspots, setHotspots] = useState([])
  const [effThreshold, setEffThreshold] = useState(null)
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [selected, setSelected] = useState(null) // {lat,lng}
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [tab, setTab] = useState('model')
  const [flyTo, setFlyTo] = useState(null)

  const s = useDebounced(scenario)
  const th = useDebounced(threshold)
  const k = useDebounced(units)

  useEffect(() => {
    Promise.all([api.meta(), api.model()])
      .then(([m, mo]) => { setMeta(m); setModel(mo) })
      .catch((e) => setError(`Cannot reach the TerraSight API (${e.message}). Is the backend running on :8000?`))
  }, [])

  useEffect(() => {
    if (!meta) return
    setLoading(true)
    Promise.all([api.grid(s), api.stats(s)])
      .then(([g, st]) => { setGrid(g); setStats(st); setError(null) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [meta, s])

  useEffect(() => {
    if (!meta) return
    api.hotspots(s, th).then((r) => { setHotspots(r.hotspots); setEffThreshold(r.effective_threshold) }).catch(() => {})
  }, [meta, s, th])

  useEffect(() => {
    if (!meta || !layers.resources) return
    api.resources(s, k).then((r) => setSites(r.sites)).catch(() => {})
  }, [meta, s, k, layers.resources])

  const reqId = useRef(0)
  useEffect(() => {
    if (!selected) return
    const id = ++reqId.current
    setAnalyzing(true)
    api.analyze(selected.lat, selected.lng, s)
      .then((a) => id === reqId.current && setAnalysis(a))
      .catch((e) => id === reqId.current && setAnalysis({ error: e.message }))
      .finally(() => id === reqId.current && setAnalyzing(false))
  }, [selected, s])

  const onMapClick = (lat, lng) => {
    setSelected({ lat, lng })
    setTab('site')
  }

  const applyPreset = (key) => {
    setPreset(key)
    const p = meta.scenarios[key]
    setScenario({ temp_delta: p.temp_delta, wind_delta: p.wind_delta, humidity_delta: p.humidity_delta, drought: p.drought })
  }

  const scenarioName = useMemo(() => {
    if (!meta) return ''
    const p = meta.scenarios[preset]
    const same = p && ['temp_delta', 'wind_delta', 'humidity_delta', 'drought'].every((x) => p[x] === scenario[x])
    return same ? p.name : 'Custom scenario'
  }, [meta, preset, scenario])

  const downloadGeoJSON = () => {
    if (!grid) return
    const blob = new Blob([JSON.stringify(grid)], { type: 'application/geo+json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `terrasight-risk-${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.geojson`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo"><Hexagon size={22} strokeWidth={2.4} /><Flame size={11} className="logo-flame" /></div>
          <div>
            <div className="brand-name">TerraSight</div>
            <div className="brand-sub">AI Geospatial Wildfire Intelligence</div>
          </div>
        </div>
        <div className="topbar-mid">
          <span className="pill pill-scenario"><Activity size={13} /> {scenarioName || '—'}</span>
          <span className="pill">Southern California · {grid ? grid.features.length : '…'} hex cells</span>
        </div>
        <div className="topbar-right">
          {model && (
            <span className="pill pill-model"><Cpu size={13} /> {model.selected_model} · AUC {model.leaderboard[0].auc.toFixed(3)}</span>
          )}
          <span className={`status-dot ${error ? 'err' : loading ? 'busy' : 'ok'}`} />
        </div>
      </header>

      <main className="layout">
        <ControlPanel
          meta={meta} stats={stats} scenario={scenario} setScenario={(v) => { setScenario(v); setPreset('custom') }}
          preset={preset} applyPreset={applyPreset} layers={layers} setLayers={setLayers}
          threshold={threshold} setThreshold={setThreshold} units={units} setUnits={setUnits}
          onDownload={downloadGeoJSON}
        />

        <section className="map-wrap">
          {error && <div className="banner-error">{error}</div>}
          {loading && <div className="map-loading"><span className="spinner" /> Running model…</div>}
          <MapView
            meta={meta} grid={grid} hotspots={hotspots} sites={sites} layers={layers}
            selected={selected} onClick={onMapClick} flyTo={flyTo}
          />
          {!selected && meta && (
            <div className="map-hint">Click anywhere on land for an AI site assessment</div>
          )}
        </section>

        <InsightPanel
          tab={tab} setTab={setTab} model={model} stats={stats} analysis={analysis} analyzing={analyzing}
          hotspots={hotspots} sites={sites} layers={layers} threshold={threshold} effThreshold={effThreshold}
          onFocus={(h) => { setFlyTo({ lat: h.lat, lng: h.lng, z: 11, t: Date.now() }); onMapClick(h.lat, h.lng) }}
        />
      </main>
    </div>
  )
}
