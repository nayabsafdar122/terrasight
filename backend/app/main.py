"""TerraSight API — AI geospatial wildfire risk intelligence."""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.cluster import DBSCAN, KMeans

from . import geo
from .model import RiskModel, RISK_BANDS, band

app = FastAPI(
    title="TerraSight API",
    version="1.0.0",
    description="AI-powered geospatial wildfire risk prediction, hotspot detection and "
                "resource planning for Southern California.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

HEX_SIZE = 0.032
MODEL = RiskModel()
GRID_CENTERS, GRID_POLYS = geo.hex_grid(HEX_SIZE)
GRID_X = geo.environmental_features(GRID_CENTERS[:, 0], GRID_CENTERS[:, 1])
CELL_KM2 = geo.cell_area_km2(HEX_SIZE)
PEOPLE_PER_KM2_AT_FULL_DENSITY = 4200

SCENARIOS = {
    "baseline": {"name": "Current conditions", "temp_delta": 0, "wind_delta": 0, "humidity_delta": 0, "drought": 0},
    "santa_ana": {"name": "Santa Ana wind event", "temp_delta": 4, "wind_delta": 70, "humidity_delta": -20, "drought": 0.2},
    "climate_2050": {"name": "2050 climate (high emissions)", "temp_delta": 3, "wind_delta": 5, "humidity_delta": -7, "drought": 0.35},
    "drought": {"name": "Multi-year drought", "temp_delta": 1.5, "wind_delta": 0, "humidity_delta": -10, "drought": 0.7},
    "wet_year": {"name": "Wet El Niño year", "temp_delta": -1.5, "wind_delta": -10, "humidity_delta": 12, "drought": 0},
}


# Train at import time so it also works on serverless platforms (Vercel) where
# ASGI lifespan events may not run. Takes a few seconds on a cold start.
MODEL.train()


# ------------------------------------------------------------- helpers ----
def _key(t, w, h, d):
    return (round(t, 1), round(w, 0), round(h, 0), round(d, 2))


@lru_cache(maxsize=64)
def _grid_risk(key):
    t, w, h, d = key
    Xs = geo.apply_scenario(GRID_X, t, w, h, d)
    return MODEL.predict(Xs), Xs


def _scenario_params(temp_delta, wind_delta, humidity_delta, drought):
    return _key(temp_delta, wind_delta, humidity_delta, drought)


ScenarioQ = dict(
    temp_delta=Query(0.0, ge=-10, le=10, description="Temperature anomaly (°C)"),
    wind_delta=Query(0.0, ge=-50, le=150, description="Wind change (%)"),
    humidity_delta=Query(0.0, ge=-40, le=40, description="Humidity change (pct points)"),
    drought=Query(0.0, ge=0, le=1, description="Drought severity 0-1"),
)


# --------------------------------------------------------------- routes ----
@app.get("/api/health")
def health():
    return {"status": "ok", "model_ready": MODEL.model is not None, "cells": int(len(GRID_CENTERS))}


@app.get("/api/meta")
def meta():
    return {
        "bbox": geo.BBOX,
        "center": geo.CENTER,
        "risk_bands": [{"max": ub, "label": l, "color": c} for ub, l, c in RISK_BANDS],
        "scenarios": SCENARIOS,
        "places": [{"name": c[4], "lat": c[0], "lng": c[1]} for c in geo.CITIES],
        "features": [{"key": f, "label": geo.FEATURE_LABELS[f]} for f in geo.FEATURES],
        "cell_area_km2": round(CELL_KM2, 2),
        "coast": [[round(float(a), 4), round(float(b), 4)] for a, b in geo.COAST],
    }


@app.get("/api/model")
def model_info():
    return MODEL.info


@app.get("/api/grid")
def grid(temp_delta: float = ScenarioQ["temp_delta"], wind_delta: float = ScenarioQ["wind_delta"],
         humidity_delta: float = ScenarioQ["humidity_delta"], drought: float = ScenarioQ["drought"]):
    """GeoJSON hexagon grid with predicted risk for every land cell."""
    p, Xs = _grid_risk(_scenario_params(temp_delta, wind_delta, humidity_delta, drought))
    feats = []
    for i, ring in enumerate(GRID_POLYS):
        label, color = band(float(p[i]))
        feats.append({
            "type": "Feature",
            "id": i,
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {
                "id": i,
                "risk": round(float(p[i]), 4),
                "band": label,
                "color": color,
                "lat": round(float(GRID_CENTERS[i, 0]), 5),
                "lng": round(float(GRID_CENTERS[i, 1]), 5),
                "elevation_m": round(float(Xs[i, 0])),
                "ndvi": round(float(Xs[i, 2]), 2),
                "temperature_c": round(float(Xs[i, 3]), 1),
                "humidity_pct": round(float(Xs[i, 4])),
                "wind_kmh": round(float(Xs[i, 5])),
            },
        })
    return {"type": "FeatureCollection", "features": feats}


@app.get("/api/stats")
def stats(temp_delta: float = ScenarioQ["temp_delta"], wind_delta: float = ScenarioQ["wind_delta"],
          humidity_delta: float = ScenarioQ["humidity_delta"], drought: float = ScenarioQ["drought"]):
    key = _scenario_params(temp_delta, wind_delta, humidity_delta, drought)
    p, Xs = _grid_risk(key)
    p0, _ = _grid_risk(_key(0, 0, 0, 0))
    labels = [band(float(v))[0] for v in p]
    counts = {b[1]: 0 for b in RISK_BANDS}
    for l in labels:
        counts[l] += 1
    high = p >= 0.5
    pop = Xs[:, 7] * CELL_KM2 * PEOPLE_PER_KM2_AT_FULL_DENSITY
    hist, edges = np.histogram(p, bins=20, range=(0, 1))
    return {
        "mean_risk": round(float(p.mean()), 4),
        "mean_risk_baseline": round(float(p0.mean()), 4),
        "high_risk_cells": int(high.sum()),
        "high_risk_area_km2": round(float(high.sum() * CELL_KM2)),
        "total_area_km2": round(float(len(p) * CELL_KM2)),
        "population_exposed": int(pop[high].sum()),
        "band_counts": [{"band": b[1], "color": b[2], "count": counts[b[1]]} for b in RISK_BANDS],
        "histogram": [{"bin": f"{edges[i]:.2f}", "count": int(hist[i])} for i in range(len(hist))],
    }


@app.get("/api/hotspots")
def hotspots(threshold: float = Query(0.6, ge=0.2, le=0.95),
             temp_delta: float = ScenarioQ["temp_delta"], wind_delta: float = ScenarioQ["wind_delta"],
             humidity_delta: float = ScenarioQ["humidity_delta"], drought: float = ScenarioQ["drought"]):
    """DBSCAN spatial clustering of high-risk cells into named hotspot zones."""
    p, Xs = _grid_risk(_scenario_params(temp_delta, wind_delta, humidity_delta, drought))
    # adaptive: in extreme scenarios most of the map is "high", so focus on the worst 15%
    eff = float(max(threshold, np.quantile(p, 0.85)))
    idx = np.where(p >= eff)[0]
    if len(idx) < 3:
        return {"threshold": threshold, "effective_threshold": round(eff, 3), "hotspots": []}
    coords = np.radians(GRID_CENTERS[idx])
    eps_km = HEX_SIZE * 111 * 2.1
    labels = DBSCAN(eps=eps_km / 6371.0, min_samples=3, metric="haversine").fit_predict(coords)
    out = []
    for lab in sorted(set(labels) - {-1}):
        m = idx[labels == lab]
        w = p[m]
        clat = float(np.average(GRID_CENTERS[m, 0], weights=w))
        clng = float(np.average(GRID_CENTERS[m, 1], weights=w))
        city, dist = geo.nearest_city(clat, clng)
        out.append({
            "id": int(lab),
            "lat": round(clat, 5), "lng": round(clng, 5),
            "cells": int(len(m)),
            "area_km2": round(len(m) * CELL_KM2),
            "mean_risk": round(float(w.mean()), 3),
            "max_risk": round(float(w.max()), 3),
            "near": city,
            "distance_km": round(dist, 1),
            "avg_wind_kmh": round(float(Xs[m, 5].mean())),
            "avg_humidity_pct": round(float(Xs[m, 4].mean())),
        })
    out.sort(key=lambda h: -(h["mean_risk"] * h["cells"]))
    for rank, h in enumerate(out, 1):
        h["rank"] = rank
        h["name"] = f"Zone {chr(64 + rank) if rank <= 26 else rank} · {h['near']}"
    return {"threshold": threshold, "effective_threshold": round(eff, 3), "hotspots": out}


@app.get("/api/resources")
def resources(k: int = Query(6, ge=2, le=15),
              temp_delta: float = ScenarioQ["temp_delta"], wind_delta: float = ScenarioQ["wind_delta"],
              humidity_delta: float = ScenarioQ["humidity_delta"], drought: float = ScenarioQ["drought"]):
    """Risk-weighted K-Means: optimal staging sites for k fire-response units."""
    p, _ = _grid_risk(_scenario_params(temp_delta, wind_delta, humidity_delta, drought))
    w = np.clip(p - 0.2, 0, None) ** 2
    if w.sum() == 0:
        return {"sites": []}
    xy = np.column_stack([GRID_CENTERS[:, 0], GRID_CENTERS[:, 1] * 0.83])
    km = KMeans(n_clusters=k, n_init=6, random_state=3).fit(xy, sample_weight=w)
    sites = []
    for c in range(k):
        m = km.labels_ == c
        lat, lng = float(km.cluster_centers_[c, 0]), float(km.cluster_centers_[c, 1] / 0.83)
        d = np.array([geo.haversine_km(lat, lng, a, b) for a, b in GRID_CENTERS[m]])
        ww = w[m]
        city, _ = geo.nearest_city(lat, lng)
        sites.append({
            "id": c,
            "lat": round(lat, 5), "lng": round(lng, 5),
            "near": city,
            "coverage_cells": int(m.sum()),
            "risk_load": round(float(ww.sum()), 2),
            "avg_response_km": round(float(np.average(d, weights=ww)) if ww.sum() > 0 else float(d.mean()), 1),
        })
    sites.sort(key=lambda s: -s["risk_load"])
    tot = sum(s["risk_load"] for s in sites) or 1
    for i, s in enumerate(sites, 1):
        s["priority"] = i
        s["share_pct"] = round(100 * s["risk_load"] / tot, 1)
    return {"k": k, "sites": sites}


class AnalyzeRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    temp_delta: float = 0
    wind_delta: float = 0
    humidity_delta: float = 0
    drought: float = 0


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    """Full AI site assessment for any point: risk, drivers, scenario sensitivity, advice."""
    if not (geo.BBOX["min_lat"] - 0.1 <= req.lat <= geo.BBOX["max_lat"] + 0.1 and
            geo.BBOX["min_lng"] - 0.1 <= req.lng <= geo.BBOX["max_lng"] + 0.1):
        raise HTTPException(400, "Point is outside the modelled region (Southern California).")
    if not bool(geo.is_land(np.array([req.lat]), np.array([req.lng]))[0]):
        raise HTTPException(400, "That point is in the ocean — pick a location on land.")

    x0 = geo.environmental_features(req.lat, req.lng)
    x = geo.apply_scenario(x0, req.temp_delta, req.wind_delta, req.humidity_delta, req.drought)
    p, impacts = MODEL.explain(x[0])
    label, color = band(p)

    # sensitivity to each scenario preset
    sens = []
    for key, s in SCENARIOS.items():
        xs = geo.apply_scenario(x0, s["temp_delta"], s["wind_delta"], s["humidity_delta"], s["drought"])
        sens.append({"scenario": key, "name": s["name"], "risk": round(float(MODEL.predict(xs)[0]), 4)})

    # wind curve: risk vs wind change for this site
    curve = []
    for wd in range(-40, 151, 10):
        xs = geo.apply_scenario(x0, req.temp_delta, wd, req.humidity_delta, req.drought)
        curve.append({"wind_delta": wd, "risk": round(float(MODEL.predict(xs)[0]), 4)})

    city, dist = geo.nearest_city(req.lat, req.lng)
    feats = dict(zip(geo.FEATURES, x[0]))
    return {
        "lat": req.lat, "lng": req.lng,
        "risk": round(p, 4), "band": label, "color": color,
        "percentile": round(float((_grid_risk(_key(req.temp_delta, req.wind_delta, req.humidity_delta,
                                                    req.drought))[0] < p).mean() * 100), 1),
        "nearest_place": city, "distance_km": round(dist, 1),
        "features": {k: round(float(v), 3) for k, v in feats.items()},
        "drivers": impacts,
        "scenario_sensitivity": sens,
        "wind_curve": curve,
        "recommendations": _recommend(p, feats, impacts),
    }


def _recommend(p, f, impacts):
    recs = []
    top_up = [i["feature"] for i in impacts if i["impact"] > 0.02][:3]
    if p >= 0.7:
        recs.append("Extreme exposure: require Class A fire-rated roofing and ember-resistant vents for any structure.")
        recs.append("Prioritise this site for pre-positioned suppression resources during Red Flag warnings.")
    elif p >= 0.5:
        recs.append("High exposure: maintain 30 m defensible space and schedule annual fuel-reduction treatment.")
    elif p >= 0.3:
        recs.append("Moderate exposure: standard defensible space and seasonal brush clearance recommended.")
    else:
        recs.append("Low exposure: suitable for development with standard building codes.")
    if "ndvi" in top_up or f["ndvi"] > 0.45:
        recs.append("Dense vegetation drives risk — consider prescribed burns or mechanical thinning nearby.")
    if "wind_kmh" in top_up or f["wind_kmh"] > 30:
        recs.append("Located in a wind corridor — plan evacuation routes perpendicular to Santa Ana wind direction.")
    if "slope_deg" in top_up or f["slope_deg"] > 12:
        recs.append("Steep terrain accelerates fire spread uphill — avoid ridge-top siting of critical assets.")
    if f["humidity_pct"] < 25:
        recs.append("Very dry air mass — fuels ignite easily; restrict outdoor equipment use on dry days.")
    if f["urban_density"] > 0.5 and p < 0.3:
        recs.append("Urban fabric acts as a firebreak here; focus on wildland-urban interface edges instead.")
    insurance = "Standard" if p < 0.3 else "Elevated" if p < 0.5 else "High" if p < 0.7 else "Severe"
    recs.append(f"Indicative insurance risk tier: {insurance}.")
    return recs


# ------------------------------------------------ serve built frontend ----
# After `npm run build` in /frontend, the API also serves the web app at "/".
import os as _os
from fastapi.staticfiles import StaticFiles as _Static

_DIST = _os.path.join(_os.path.dirname(__file__), "..", "..", "frontend", "dist")
if _os.path.isdir(_DIST):
    app.mount("/", _Static(directory=_DIST, html=True), name="web")
