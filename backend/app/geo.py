"""
Geospatial feature engine for TerraSight.

Generates a realistic, deterministic environmental surface for Southern California
(elevation, slope, vegetation, climate, urban density, coast distance) so the whole
platform runs offline with no external data downloads. Swap `environmental_features`
for real rasters (SRTM, Sentinel-2 NDVI, ERA5 climate) in production.
"""
from __future__ import annotations

import math
import numpy as np

# ---------------------------------------------------------------- region ----
BBOX = {"min_lat": 33.55, "max_lat": 34.75, "min_lng": -119.05, "max_lng": -117.05}
CENTER = [34.12, -118.15]

# Approximate SoCal coastline (lat, lng), ordered by increasing longitude.
COAST = np.array([
    (34.30, -119.30), (34.15, -119.20), (34.09, -119.06),
    (34.05, -118.95), (34.03, -118.80), (34.03, -118.55), (33.95, -118.45),
    (33.85, -118.40), (33.77, -118.40), (33.72, -118.30), (33.76, -118.12),
    (33.66, -117.98), (33.58, -117.85), (33.47, -117.70), (33.30, -117.45),
    (33.10, -117.30), (32.90, -117.05),
])
COAST = COAST[np.argsort(COAST[:, 1])]

FEATURES = [
    "elevation_m", "slope_deg", "ndvi", "temperature_c", "humidity_pct",
    "wind_kmh", "fuel_dryness", "urban_density", "dist_coast_km",
]
FEATURE_LABELS = {
    "elevation_m": "Elevation (m)",
    "slope_deg": "Slope (°)",
    "ndvi": "Vegetation index (NDVI)",
    "temperature_c": "Max temperature (°C)",
    "humidity_pct": "Relative humidity (%)",
    "wind_kmh": "Wind speed (km/h)",
    "fuel_dryness": "Fuel dryness index (0-1)",
    "urban_density": "Urban density (0-1)",
    "dist_coast_km": "Distance to coast (km)",
}

# Terrain & settlement anchors: (lat, lng, amplitude, spread_deg)
MOUNTAINS = [
    (34.30, -118.05, 2100, 0.16),  # San Gabriel Mtns
    (34.20, -117.35, 2600, 0.18),  # San Bernardino Mtns
    (34.10, -118.75, 750, 0.12),   # Santa Monica Mtns
    (34.40, -118.60, 1100, 0.14),  # Santa Susana / Sierra Pelona
    (33.70, -117.55, 1300, 0.13),  # Santa Ana Mtns
    (34.55, -118.90, 1500, 0.17),  # Topatopa / Los Padres
    (33.85, -117.10, 1100, 0.15),  # San Jacinto foothills
]
CITIES = [
    (34.05, -118.25, 1.00, 0.10, "Los Angeles"),
    (33.77, -118.19, 0.80, 0.07, "Long Beach"),
    (33.75, -117.87, 0.80, 0.08, "Santa Ana"),
    (34.15, -118.14, 0.70, 0.06, "Pasadena"),
    (34.18, -118.40, 0.80, 0.09, "San Fernando Valley"),
    (33.98, -117.38, 0.70, 0.08, "Riverside"),
    (34.11, -117.29, 0.65, 0.07, "San Bernardino"),
    (34.06, -117.65, 0.70, 0.09, "Inland Empire West"),
    (33.88, -118.35, 0.85, 0.07, "South Bay"),
    (34.42, -118.55, 0.55, 0.06, "Santa Clarita"),
    (34.20, -119.15, 0.55, 0.06, "Oxnard"),
]
WIND_CORRIDORS = [  # Santa Ana wind passes
    (34.25, -118.35, 38, 0.10),  # Newhall / Sylmar pass
    (34.00, -117.45, 42, 0.13),  # Cajon pass outflow
    (33.80, -117.70, 34, 0.09),  # Santa Ana canyon
    (34.30, -118.85, 30, 0.10),
]


def _gauss(lat, lng, anchors):
    lat = np.asarray(lat, float)
    lng = np.asarray(lng, float)
    out = np.zeros_like(lat)
    for a in anchors:
        alat, alng, amp, s = a[0], a[1], a[2], a[3]
        out += amp * np.exp(-(((lat - alat) ** 2) + ((lng - alng) * 0.83) ** 2) / (2 * s * s))
    return out


def coast_lat(lng):
    return np.interp(lng, COAST[:, 1], COAST[:, 0])


def is_land(lat, lng):
    return np.asarray(lat) > coast_lat(np.asarray(lng)) + 0.005


def dist_coast_km(lat, lng):
    lat = np.atleast_1d(np.asarray(lat, float))
    lng = np.atleast_1d(np.asarray(lng, float))
    # dense coast polyline sampling
    t = np.linspace(COAST[0, 1], COAST[-1, 1], 400)
    cl = np.interp(t, COAST[:, 1], COAST[:, 0])
    dlat = (lat[:, None] - cl[None, :]) * 111.0
    dlng = (lng[:, None] - t[None, :]) * 111.0 * np.cos(np.radians(lat[:, None]))
    return np.sqrt(dlat ** 2 + dlng ** 2).min(axis=1)


def _ripple(lat, lng):
    """Deterministic micro-terrain so the surface is not perfectly smooth."""
    return (np.sin(lat * 47.0) * np.cos(lng * 39.0) + 0.6 * np.sin(lat * 91.0 + lng * 73.0))


def elevation(lat, lng):
    lat = np.asarray(lat, float)
    lng = np.asarray(lng, float)
    inland = np.clip(dist_coast_km(lat, lng), 0, None)
    base = 15 + 2.2 * inland
    elev = base + _gauss(lat, lng, MOUNTAINS) + 60 * _ripple(lat, lng)
    return np.clip(elev, 0, None)


def environmental_features(lat, lng) -> np.ndarray:
    """Return an (n, len(FEATURES)) matrix of environmental features."""
    lat = np.atleast_1d(np.asarray(lat, float))
    lng = np.atleast_1d(np.asarray(lng, float))

    elev = elevation(lat, lng)
    d = 0.004
    dz_lat = (elevation(lat + d, lng) - elevation(lat - d, lng)) / (2 * d * 111000)
    dz_lng = (elevation(lat, lng + d) - elevation(lat, lng - d)) / (2 * d * 111000 * np.cos(np.radians(lat)))
    slope = np.degrees(np.arctan(np.sqrt(dz_lat ** 2 + dz_lng ** 2))) * 4.0

    urban = np.clip(_gauss(lat, lng, [(c[0], c[1], c[2], c[3]) for c in CITIES]), 0, 1)
    coast = dist_coast_km(lat, lng)

    # Vegetation peaks in foothills / mid elevations, suppressed by cities & high desert
    ndvi = (0.18 + 0.45 * np.exp(-((elev - 900) ** 2) / (2 * 650 ** 2))
            - 0.38 * urban + 0.05 * _ripple(lat, lng) - 0.006 * np.clip(coast - 50, 0, None))
    ndvi = np.clip(ndvi, 0.02, 0.85)

    temp = 24 + 0.16 * np.clip(coast, 0, 90) - 0.0055 * elev + 2.0 * urban + 0.6 * _ripple(lng, lat)
    humidity = np.clip(68 - 0.42 * np.clip(coast, 0, 90) + 0.004 * elev - 3 * _ripple(lat, lng), 6, 95)
    wind = 9 + _gauss(lat, lng, WIND_CORRIDORS) + 0.004 * elev + 2 * _ripple(lat * 1.3, lng)

    dryness = np.clip(0.15 + 0.006 * np.clip(coast, 0, 80) + 0.01 * (temp - 25)
                      - 0.004 * (humidity - 40) + 0.05 * _ripple(lng, lat), 0, 1)

    return np.column_stack([elev, slope, ndvi, temp, humidity, wind, dryness, urban, coast])


def apply_scenario(X: np.ndarray, temp_delta=0.0, wind_delta=0.0, humidity_delta=0.0, drought=0.0):
    """Climate what-if scenario applied to a feature matrix (returns a copy)."""
    X = X.copy()
    i = {f: k for k, f in enumerate(FEATURES)}
    X[:, i["temperature_c"]] += temp_delta
    X[:, i["wind_kmh"]] = np.clip(X[:, i["wind_kmh"]] * (1 + wind_delta / 100.0), 0, None)
    X[:, i["humidity_pct"]] = np.clip(X[:, i["humidity_pct"]] + humidity_delta, 3, 100)
    # drought lowers live fuel moisture -> drier fuels, slightly browner vegetation
    X[:, i["fuel_dryness"]] = np.clip(X[:, i["fuel_dryness"]] + 0.55 * drought
                                      + 0.02 * temp_delta - 0.008 * humidity_delta, 0, 1)
    X[:, i["ndvi"]] = np.clip(X[:, i["ndvi"]] * (1 - 0.12 * drought), 0.01, 0.9)
    return X


# ------------------------------------------------------------- hex grid ----
def hex_grid(size_deg: float = 0.032):
    """Pointy-top hexagon grid over the BBOX, land cells only.

    Returns (centers[n,2] as lat/lng, polygons list of [[lng,lat],...]).
    """
    k = 0.83  # lng compression for ~34°N
    w = math.sqrt(3) * size_deg / k  # width in lng degrees
    h = 1.5 * size_deg               # vertical spacing in lat degrees
    centers, polys = [], []
    row = 0
    lat = BBOX["min_lat"]
    while lat <= BBOX["max_lat"]:
        offset = (w / 2) if row % 2 else 0.0
        lng = BBOX["min_lng"] + offset
        while lng <= BBOX["max_lng"]:
            centers.append((lat, lng))
            lng += w
        lat += h
        row += 1
    centers = np.array(centers)
    land = is_land(centers[:, 0], centers[:, 1])
    centers = centers[land]
    for clat, clng in centers:
        ring = []
        for j in range(6):
            ang = math.radians(60 * j - 30)
            ring.append([round(clng + size_deg * math.cos(ang) / k, 5),
                         round(clat + size_deg * math.sin(ang), 5)])
        ring.append(ring[0])
        polys.append(ring)
    return centers, polys


def cell_area_km2(size_deg: float = 0.032):
    s_km = size_deg * 111.0
    return 1.5 * math.sqrt(3) * s_km * s_km * 0.95


def nearest_city(lat: float, lng: float):
    best, bd = None, 1e9
    for c in CITIES:
        dd = haversine_km(lat, lng, c[0], c[1])
        if dd < bd:
            best, bd = c[4], dd
    return best, bd


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
