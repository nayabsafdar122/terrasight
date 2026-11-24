const BASE = import.meta.env.VITE_API_URL || ''

function qs(params) {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))
  ).toString()
}

async function get(path, params = {}) {
  const res = await fetch(`${BASE}${path}?${qs(params)}`)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText)
  return res.json()
}

export const api = {
  meta: () => get('/api/meta'),
  model: () => get('/api/model'),
  grid: (s) => get('/api/grid', s),
  stats: (s) => get('/api/stats', s),
  hotspots: (s, threshold) => get('/api/hotspots', { ...s, threshold }),
  resources: (s, k) => get('/api/resources', { ...s, k }),
  analyze: async (lat, lng, s) => {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, ...s }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || 'Analysis failed')
    return data
  },
}
