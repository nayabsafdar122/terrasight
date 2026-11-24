import { Brain, Crosshair, Flame, Truck, Loader2, ShieldCheck, MousePointerClick, AlertTriangle } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const AXIS = { fill: '#7b8699', fontSize: 10 }
const TT = { contentStyle: { background: '#0f1522', border: '1px solid #26324a', borderRadius: 8, fontSize: 12 }, labelStyle: { color: '#9aa6bd' } }

function riskColor(p) {
  if (p < 0.15) return '#1a9850'
  if (p < 0.3) return '#91cf60'
  if (p < 0.5) return '#fee08b'
  if (p < 0.7) return '#fc8d59'
  return '#d73027'
}

function Gauge({ value, color }) {
  const r = 70, c = Math.PI * r
  return (
    <svg viewBox="0 0 180 114" className="gauge">
      <defs>
        <linearGradient id="g-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#1a9850" /><stop offset=".35" stopColor="#91cf60" />
          <stop offset=".55" stopColor="#fee08b" /><stop offset=".75" stopColor="#fc8d59" /><stop offset="1" stopColor="#d73027" />
        </linearGradient>
      </defs>
      <path d="M20 92 A70 70 0 0 1 160 92" fill="none" stroke="#1c2435" strokeWidth="13" strokeLinecap="round" />
      <path d="M20 92 A70 70 0 0 1 160 92" fill="none" stroke="url(#g-grad)" strokeWidth="13" strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
      <text x="90" y="78" textAnchor="middle" className="gauge-val" fill={color}>{Math.round(value * 100)}%</text>
      <text x="90" y="112" textAnchor="middle" className="gauge-lbl">10-yr burn probability</text>
    </svg>
  )
}

function Drivers({ drivers }) {
  const max = Math.max(...drivers.map((d) => Math.abs(d.impact)), 0.01)
  return (
    <div className="drivers">
      {drivers.map((d) => (
        <div key={d.feature} className="driver">
          <div className="driver-label" title={`Value ${d.value} · regional avg ${d.regional_avg}`}>{d.label}</div>
          <div className="driver-track">
            <div className="driver-mid" />
            <div className={`driver-bar ${d.impact >= 0 ? 'pos' : 'neg'}`}
              style={{ width: `${(Math.abs(d.impact) / max) * 50}%`, [d.impact >= 0 ? 'left' : 'right']: '50%' }} />
          </div>
          <div className={`driver-val mono ${d.impact >= 0 ? 'pos' : 'neg'}`}>{d.impact >= 0 ? '+' : ''}{(d.impact * 100).toFixed(1)}</div>
        </div>
      ))}
    </div>
  )
}

function SiteAnalysis({ analysis, analyzing }) {
  if (!analysis && !analyzing) {
    return (
      <div className="empty">
        <MousePointerClick size={30} />
        <h3>AI site assessment</h3>
        <p>Click any land location on the map. The model will score its wildfire exposure, explain what drives it, and stress-test it against climate scenarios.</p>
      </div>
    )
  }
  if (analyzing && !analysis) return <div className="empty"><Loader2 className="spin" size={26} /><p>Analysing site…</p></div>
  if (analysis.error) return <div className="empty warn"><AlertTriangle size={26} /><p>{analysis.error}</p></div>

  const a = analysis
  const f = a.features
  return (
    <div className={`site ${analyzing ? 'dim' : ''}`}>
      <div className="site-head">
        <div>
          <div className="site-coords mono">{a.lat.toFixed(4)}°, {a.lng.toFixed(4)}°</div>
          <div className="site-near">{a.distance_km} km from {a.nearest_place}</div>
        </div>
        <span className="band-chip" style={{ background: a.color + '22', color: a.color, borderColor: a.color + '66' }}>{a.band}</span>
      </div>
      <Gauge value={a.risk} color={a.color} />
      <div className="site-pct">Riskier than <b>{a.percentile}%</b> of the region under this scenario</div>

      <div className="card">
        <div className="card-title">Why this score? <span className="muted">impact in risk points vs. regional average</span></div>
        <Drivers drivers={a.drivers} />
      </div>

      <div className="card">
        <div className="card-title">Scenario stress test</div>
        <div className="sens">
          {a.scenario_sensitivity.map((s) => (
            <div key={s.scenario} className="sens-row">
              <span>{s.name}</span>
              <div className="sens-track"><div style={{ width: `${s.risk * 100}%`, background: riskColor(s.risk) }} /></div>
              <span className="mono">{Math.round(s.risk * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Wind sensitivity curve</div>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={a.wind_curve} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="wc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ff6b35" stopOpacity={0.6} /><stop offset="1" stopColor="#ff6b35" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1c2435" vertical={false} />
            <XAxis dataKey="wind_delta" tick={AXIS} tickFormatter={(v) => `${v}%`} />
            <YAxis tick={AXIS} domain={[0, 1]} tickFormatter={(v) => `${v * 100}`} />
            <Tooltip {...TT} formatter={(v) => [`${(v * 100).toFixed(1)}%`, 'Risk']} labelFormatter={(l) => `Wind ${l > 0 ? '+' : ''}${l}%`} />
            <Area type="monotone" dataKey="risk" stroke="#ff6b35" strokeWidth={2} fill="url(#wc)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="card-title">Environmental profile</div>
        <div className="envgrid">
          <div><span>Elevation</span><b>{Math.round(f.elevation_m)} m</b></div>
          <div><span>Slope</span><b>{f.slope_deg.toFixed(1)}°</b></div>
          <div><span>NDVI</span><b>{f.ndvi.toFixed(2)}</b></div>
          <div><span>Temp</span><b>{f.temperature_c.toFixed(1)}°C</b></div>
          <div><span>Humidity</span><b>{Math.round(f.humidity_pct)}%</b></div>
          <div><span>Wind</span><b>{Math.round(f.wind_kmh)} km/h</b></div>
          <div><span>Fuel dryness</span><b>{f.fuel_dryness.toFixed(2)}</b></div>
          <div><span>Urban</span><b>{f.urban_density.toFixed(2)}</b></div>
          <div><span>To coast</span><b>{Math.round(f.dist_coast_km)} km</b></div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><ShieldCheck size={14} /> AI recommendations</div>
        <ul className="recs">{a.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
    </div>
  )
}

function HotspotList({ hotspots, sites, layers, threshold, effThreshold, onFocus }) {
  return (
    <div className="hslist">
      <div className="muted small">{hotspots.length} cluster{hotspots.length === 1 ? '' : 's'} of cells ≥ {Math.round((effThreshold || threshold) * 100)}% risk, found by density-based clustering (DBSCAN, haversine).</div>
      {hotspots.length === 0 && <div className="empty small"><p>No hotspots at this threshold — lower it or try a harsher scenario.</p></div>}
      {hotspots.map((h) => (
        <button key={h.id} className="hs-card" onClick={() => onFocus(h)}>
          <div className="hs-rank" style={{ background: riskColor(h.mean_risk) }}>{String.fromCharCode(64 + h.rank)}</div>
          <div className="hs-body">
            <div className="hs-name">{h.name}</div>
            <div className="hs-meta">{h.area_km2} km² · {h.cells} cells · wind {h.avg_wind_kmh} km/h · RH {h.avg_humidity_pct}%</div>
            <div className="hs-bar"><div style={{ width: `${h.mean_risk * 100}%`, background: riskColor(h.mean_risk) }} /></div>
          </div>
          <div className="hs-risk mono">{Math.round(h.mean_risk * 100)}%</div>
        </button>
      ))}

      {layers.resources && sites.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}><Truck size={14} /> Optimal response staging</div>
          <div className="muted small">Risk-weighted K-Means places units to minimise distance to the highest-risk terrain.</div>
          {sites.map((s) => (
            <button key={s.id} className="hs-card" onClick={() => onFocus(s)}>
              <div className="hs-rank site">{s.priority}</div>
              <div className="hs-body">
                <div className="hs-name">Unit {s.priority} · near {s.near}</div>
                <div className="hs-meta">Covers {s.share_pct}% of risk load · avg {s.avg_response_km} km reach</div>
              </div>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function ModelPanel({ model, stats }) {
  if (!model) return <div className="empty"><Loader2 className="spin" size={26} /><p>Training models…</p></div>
  return (
    <div className="modelp">
      <div className="card">
        <div className="card-title">Model leaderboard <span className="muted">held-out test set · n={model.n_test.toLocaleString()}</span></div>
        <table className="lb">
          <thead><tr><th>Model</th><th>AUC</th><th>Acc</th><th>Brier</th></tr></thead>
          <tbody>
            {model.leaderboard.map((r, i) => (
              <tr key={r.model} className={i === 0 ? 'best' : ''}>
                <td>{i === 0 && <span className="crown">★</span>}{r.model}</td>
                <td className="mono">{r.auc.toFixed(3)}</td>
                <td className="mono">{(r.accuracy * 100).toFixed(1)}</td>
                <td className="mono">{r.brier.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted small">Trained on {model.n_train.toLocaleString()} labelled locations in {model.trained_in_seconds}s. Target: {model.target.toLowerCase()}.</div>
      </div>

      <div className="card">
        <div className="card-title">What drives wildfire risk? <span className="muted">permutation importance</span></div>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={model.feature_importance} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: '#b6c0d4' }} width={135}
              tickFormatter={(v) => v.replace(/\s*\(.*\)$/, '')} />
            <Tooltip {...TT} cursor={{ fill: '#ffffff08' }} formatter={(v) => [`${(v * 100).toFixed(1)}%`, 'Importance']} />
            <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
              {model.feature_importance.map((_, i) => <Cell key={i} fill={`hsl(${18 + i * 6}, 95%, ${62 - i * 3.5}%)`} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {stats && (
        <div className="card">
          <div className="card-title">Risk distribution across region</div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={stats.histogram} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid stroke="#1c2435" vertical={false} />
              <XAxis dataKey="bin" tick={AXIS} interval={4} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
              <YAxis tick={AXIS} />
              <Tooltip {...TT} cursor={{ fill: '#ffffff08' }} labelFormatter={(l) => `Risk ≥ ${Math.round(l * 100)}%`} />
              <Bar dataKey="count" name="Cells" radius={[3, 3, 0, 0]}>
                {stats.histogram.map((h, i) => <Cell key={i} fill={riskColor(+h.bin + 0.025)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card pipeline">
        <div className="card-title">ML pipeline</div>
        <ol>
          <li><b>Feature engineering</b> — terrain (elevation, slope), Sentinel-style NDVI, climate, fuel dryness, urban density, coast distance per location.</li>
          <li><b>Model selection</b> — 3 classifiers benchmarked on held-out data (gradient boosting with physics-informed monotonic constraints, random forest, logistic regression); the best AUC is served.</li>
          <li><b>Spatial inference</b> — {stats ? stats.total_area_km2.toLocaleString() : '…'} km² scored on an H3-style hexagonal grid in real time.</li>
          <li><b>Spatial analytics</b> — DBSCAN hotspot detection and risk-weighted K-Means resource optimisation.</li>
          <li><b>Explainability</b> — per-site feature impacts and scenario stress tests.</li>
        </ol>
      </div>
    </div>
  )
}

export default function InsightPanel({ tab, setTab, model, stats, analysis, analyzing, hotspots, sites, layers, threshold, effThreshold, onFocus }) {
  const tabs = [
    { key: 'site', label: 'Site', icon: Crosshair },
    { key: 'hotspots', label: `Hotspots${hotspots.length ? ` · ${hotspots.length}` : ''}`, icon: Flame },
    { key: 'model', label: 'Model', icon: Brain },
  ]
  return (
    <aside className="panel panel-right">
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'site' && <SiteAnalysis analysis={analysis} analyzing={analyzing} />}
        {tab === 'hotspots' && <HotspotList hotspots={hotspots} sites={sites} layers={layers} threshold={threshold} effThreshold={effThreshold} onFocus={onFocus} />}
        {tab === 'model' && <ModelPanel model={model} stats={stats} />}
      </div>
    </aside>
  )
}
