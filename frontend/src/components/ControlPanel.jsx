import { CloudRain, Download, Droplets, Flame, Layers, Thermometer, Truck, Users, Wind, Zap, MapPinned, TrendingUp } from 'lucide-react'

const PRESET_ICONS = { baseline: MapPinned, santa_ana: Wind, climate_2050: TrendingUp, drought: Flame, wet_year: CloudRain }

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

function Slider({ icon: Icon, label, value, min, max, step, unit, onChange, color }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="slider">
      <div className="slider-head">
        <span><Icon size={14} style={{ color }} /> {label}</span>
        <span className="mono">{value > 0 && unit !== '' ? '+' : ''}{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ '--pct': `${pct}%`, '--c': color }}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

function Toggle({ on, onChange, icon: Icon, label, color }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} style={{ '--c': color }}>
      <Icon size={15} /> <span>{label}</span><span className="switch"><span /></span>
    </button>
  )
}

export default function ControlPanel({ meta, stats, scenario, setScenario, preset, applyPreset, layers, setLayers,
  threshold, setThreshold, units, setUnits, onDownload }) {
  const delta = stats ? stats.mean_risk - stats.mean_risk_baseline : 0
  const set = (k) => (v) => setScenario({ ...scenario, [k]: v })

  return (
    <aside className="panel panel-left">
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Mean regional risk</div>
          <div className="kpi-value">{stats ? (stats.mean_risk * 100).toFixed(1) : '–'}<small>%</small></div>
          {stats && Math.abs(delta) > 0.0005 && (
            <div className={`kpi-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {(Math.abs(delta) * 100).toFixed(1)} pts vs today</div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">High-risk area</div>
          <div className="kpi-value">{stats ? fmt(stats.high_risk_area_km2) : '–'}<small>km²</small></div>
          <div className="kpi-sub">{stats ? ((stats.high_risk_area_km2 / stats.total_area_km2) * 100).toFixed(0) : '–'}% of region</div>
        </div>
        <div className="kpi kpi-wide">
          <div className="kpi-label"><Users size={12} /> Residents in high-risk zones</div>
          <div className="kpi-value accent">{stats ? fmt(stats.population_exposed) : '–'}</div>
          {stats && (
            <div className="bandbar">
              {stats.band_counts.map((b) => (
                <span key={b.band} title={`${b.band}: ${b.count} cells`} style={{ flex: b.count || 0.001, background: b.color }} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-title"><Zap size={14} /> Climate scenario simulator</div>
        <div className="presets">
          {meta && Object.entries(meta.scenarios).map(([key, p]) => {
            const Icon = PRESET_ICONS[key] || Zap
            return (
              <button key={key} className={`preset ${preset === key ? 'active' : ''}`} onClick={() => applyPreset(key)}>
                <Icon size={14} /> {p.name}
              </button>
            )
          })}
        </div>
        <Slider icon={Thermometer} label="Temperature anomaly" value={scenario.temp_delta} min={-5} max={8} step={0.5} unit="°C" onChange={set('temp_delta')} color="#ff7a45" />
        <Slider icon={Wind} label="Wind speed change" value={scenario.wind_delta} min={-40} max={150} step={5} unit="%" onChange={set('wind_delta')} color="#7dd3fc" />
        <Slider icon={Droplets} label="Humidity change" value={scenario.humidity_delta} min={-30} max={30} step={1} unit=" pts" onChange={set('humidity_delta')} color="#60a5fa" />
        <Slider icon={Flame} label="Drought severity" value={Math.round(scenario.drought * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => set('drought')(v / 100)} color="#f59e0b" />
      </div>

      <div className="section">
        <div className="section-title"><Layers size={14} /> Map layers</div>
        <Toggle on={layers.risk} onChange={(v) => setLayers({ ...layers, risk: v })} icon={Layers} label="AI risk surface" color="#fc8d59" />
        <Toggle on={layers.hotspots} onChange={(v) => setLayers({ ...layers, hotspots: v })} icon={Flame} label="Hotspot clusters (DBSCAN)" color="#ef4444" />
        {layers.hotspots && (
          <div className="sub-slider">
            <span>Hotspot threshold</span>
            <input type="range" min={0.3} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
            <span className="mono">{Math.round(threshold * 100)}%</span>
          </div>
        )}
        <Toggle on={layers.resources} onChange={(v) => setLayers({ ...layers, resources: v })} icon={Truck} label="Response staging (K-Means)" color="#22d3ee" />
        {layers.resources && (
          <div className="sub-slider">
            <span>Response units</span>
            <input type="range" min={2} max={12} step={1} value={units} onChange={(e) => setUnits(+e.target.value)} />
            <span className="mono">{units}</span>
          </div>
        )}
      </div>

      <div className="legend">
        {meta && meta.risk_bands.map((b) => (
          <div key={b.label} className="legend-item"><span style={{ background: b.color }} />{b.label}</div>
        ))}
      </div>

      <button className="btn-export" onClick={onDownload}><Download size={14} /> Export risk layer (GeoJSON)</button>
    </aside>
  )
}
