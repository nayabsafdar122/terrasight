"""
Wildfire risk model for TerraSight.

* Builds a labelled training set of historical burn outcomes from the geo feature
  engine under randomised weather conditions (so the model learns how risk reacts
  to heat, wind, humidity and drought — that is what powers the scenario simulator).
* Trains and benchmarks three models (Logistic Regression, Random Forest,
  Gradient Boosting with physically-sensible monotonic constraints) and serves
  the best one.
* Explains individual predictions with feature-occlusion impacts.
"""
from __future__ import annotations

import time
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score, f1_score, brier_score_loss
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import geo

RISK_BANDS = [  # (upper bound, label, colour)
    (0.15, "Very Low", "#1a9850"),
    (0.30, "Low", "#91cf60"),
    (0.50, "Moderate", "#fee08b"),
    (0.70, "High", "#fc8d59"),
    (1.01, "Extreme", "#d73027"),
]


def band(p: float):
    for ub, label, color in RISK_BANDS:
        if p < ub:
            return label, color
    return RISK_BANDS[-1][1], RISK_BANDS[-1][2]


def _hidden_burn_probability(X: np.ndarray) -> np.ndarray:
    """Ground-truth process used only to simulate historical fire records."""
    elev, slope, ndvi, temp, hum, wind, dry, urban, coast = X.T
    fuel = np.clip((ndvi - 0.08) / 0.4, 0, 1.2)                      # fuel load
    z = (-4.3 + 2.8 * fuel + 2.0 * dry + 0.08 * (temp - 28) + 0.045 * (wind - 14)
         - 0.03 * (hum - 30) + 0.05 * slope - 3.6 * urban
         + 1.6 * dry * fuel * np.clip((wind - 10) / 25, 0, 2)          # Santa Ana interaction
         - 0.0012 * np.clip(elev - 2200, 0, None))
    return 1 / (1 + np.exp(-z))


class RiskModel:
    def __init__(self, seed: int = 7, n_samples: int = 12000):
        self.seed = seed
        self.n_samples = n_samples
        self.model = None
        self.info: dict = {}
        self.baseline = None

    # ----------------------------------------------------------- data ----
    def _build_dataset(self):
        rng = np.random.default_rng(self.seed)
        lat = rng.uniform(geo.BBOX["min_lat"], geo.BBOX["max_lat"], self.n_samples * 2)
        lng = rng.uniform(geo.BBOX["min_lng"], geo.BBOX["max_lng"], self.n_samples * 2)
        land = geo.is_land(lat, lng)
        lat, lng = lat[land][: self.n_samples], lng[land][: self.n_samples]
        X = geo.environmental_features(lat, lng)
        n = len(X)
        # randomised historical weather per record
        X = geo.apply_scenario(            # vectorised per-record weather
            X,
            temp_delta=rng.normal(0, 3.5, n),
            wind_delta=rng.normal(0, 30, n),
            humidity_delta=rng.normal(0, 12, n),
            drought=rng.uniform(0, 0.7, n),
        )
        X += rng.normal(0, 1, X.shape) * np.array([10, 0.3, 0.01, 0.3, 1.0, 0.5, 0.01, 0.01, 0.2])  # sensor noise
        y = (rng.uniform(size=n) < _hidden_burn_probability(X)).astype(int)
        return X, y

    # ---------------------------------------------------------- train ----
    def train(self):
        t0 = time.time()
        X, y = self._build_dataset()
        Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=self.seed, stratify=y)
        self.baseline = Xtr.mean(axis=0)

        # monotonic constraints: slope +, temp +, humidity -, wind +, urban -
        mono = [0, 1, 0, 1, -1, 1, 1, -1, 0]
        candidates = {
            "Logistic Regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=500)),
            "Random Forest": RandomForestClassifier(n_estimators=120, min_samples_leaf=8, max_depth=14, n_jobs=-1,
                                                    random_state=self.seed),
            "Gradient Boosting (monotonic)": HistGradientBoostingClassifier(
                max_iter=350, learning_rate=0.06, max_leaf_nodes=31, l2_regularization=0.5,
                monotonic_cst=mono, random_state=self.seed),
        }
        board = []
        fitted = {}
        for name, m in candidates.items():
            ts = time.time()
            m.fit(Xtr, ytr)
            p = m.predict_proba(Xte)[:, 1]
            board.append({
                "model": name,
                "auc": round(float(roc_auc_score(yte, p)), 4),
                "accuracy": round(float(accuracy_score(yte, p > 0.5)), 4),
                "f1": round(float(f1_score(yte, p > 0.5)), 4),
                "brier": round(float(brier_score_loss(yte, p)), 4),
                "train_seconds": round(time.time() - ts, 2),
            })
            fitted[name] = m
        board.sort(key=lambda r: -r["auc"])
        best = board[0]["model"]
        self.model = fitted[best]

        pi = permutation_importance(self.model, Xte[:2500], yte[:2500], scoring="roc_auc",
                                    n_repeats=3, random_state=self.seed, n_jobs=-1)
        imp = np.clip(pi.importances_mean, 0, None)
        imp = imp / imp.sum() if imp.sum() > 0 else imp
        self.info = {
            "selected_model": best,
            "leaderboard": board,
            "n_train": int(len(Xtr)),
            "n_test": int(len(Xte)),
            "positive_rate": round(float(y.mean()), 4),
            "feature_importance": sorted(
                [{"feature": f, "label": geo.FEATURE_LABELS[f], "importance": round(float(v), 4)}
                 for f, v in zip(geo.FEATURES, imp)],
                key=lambda r: -r["importance"]),
            "trained_in_seconds": round(time.time() - t0, 2),
            "target": "Probability of a significant wildfire burn within a 10-year window",
        }
        return self.info

    # -------------------------------------------------------- predict ----
    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(X)[:, 1]

    def explain(self, x: np.ndarray):
        """Occlusion impact: how much each feature moves risk vs. the regional average."""
        x = np.asarray(x, float).reshape(1, -1)
        p = float(self.predict(x)[0])
        rows = np.repeat(x, len(geo.FEATURES), axis=0)
        for i in range(len(geo.FEATURES)):
            rows[i, i] = self.baseline[i]
        p_occ = self.predict(rows)
        impacts = []
        for i, f in enumerate(geo.FEATURES):
            impacts.append({
                "feature": f,
                "label": geo.FEATURE_LABELS[f],
                "value": round(float(x[0, i]), 3),
                "regional_avg": round(float(self.baseline[i]), 3),
                "impact": round(p - float(p_occ[i]), 4),
            })
        impacts.sort(key=lambda r: -abs(r["impact"]))
        return p, impacts
