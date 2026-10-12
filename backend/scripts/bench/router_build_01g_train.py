"""ROUTER-BUILD-01g: train the production search-assist head (RAW-01 pick: raw concat, tuned threshold) on the tune split
and write the manifest plus the frozen held-out gate vectors. Reads the RAW-01 embedding cache, so it needs no model.
  data-scratch/chat-ab/search-recency-04/.venv/bin/python backend/scripts/bench/router_build_01g_train.py
"""
import hashlib, json, os, sys
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict, StratifiedKFold
sys.path.insert(0, os.path.dirname(__file__))
from search_recency_04 import text_of, DS
from search_recency_04_score import pick_threshold

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CACHE = os.path.join(ROOT, "data-scratch/chat-ab/router-raw-01/embcache.npz")
LABELS = os.path.join(DS, "search-recency-04-labels.json")
OUT = os.path.join(ROOT, "data-scratch/releases/router-weights")
GATE = os.path.join(ROOT, "backend/src/lib/searchAssist/__fixtures__/gate-rows-held.json")
z = np.load(CACHE, allow_pickle=True); cache = dict(zip(z["k"].tolist(), z["v"]))
emb = lambda t: np.asarray(cache["\x00" + t], dtype=np.float64)

rows = json.load(open(LABELS))["rows"]
Xa = np.stack([emb(r["prompt"]) for r in rows]); Xp = np.stack([emb(text_of(r)) for r in rows])
X = np.hstack([Xa, Xp]); y = np.array([r["category"] for r in rows])
tune = np.array([r["split"] == "tune" for r in rows])
mk = lambda: LogisticRegression(C=10, max_iter=3000, class_weight="balanced")
clf = mk().fit(X[tune], y[tune]); cls = list(clf.classes_); ir = cls.index("recency")
oof = cross_val_predict(mk(), X[tune], y[tune], cv=StratifiedKFold(5, shuffle=True, random_state=0), method="predict_proba")
thr = float(pick_threshold(list(oof[:, ir]), list(y[tune]), 0.9))
P = clf.predict_proba(X[~tune]); yh = y[~tune]; fu = np.array([bool(r.get("followUp")) for r in rows])[~tune]
over = P[:, ir] >= thr
rec = float(over[yh == "recency"].mean())
print("threshold", thr, "held recall", rec, "FS", float(over[yh == "stable"].mean()), "FN", float(over[yh == "no_tool"].mean()),
      "fu", int(over[(yh == "no_tool") & fu].sum()), "n", len(yh))

ds_sha = hashlib.sha256(open(LABELS, "rb").read()).hexdigest()
manifest = {
    "embed": {"model": "nomic-embed-text-v1.5.Q4_K_M", "dims": 768, "preprocess": "v1", "prefix": ""},
    "features": "concat", "classes": cls,
    "coef": [[round(float(c), 8) for c in row] for row in clf.coef_], "intercept": [round(float(c), 8) for c in clf.intercept_],
    "thresholds": {"websearch": {"class": "recency", "value": round(thr, 6)}},
    "label_spec_version": "search-recency-04-labels",
    "dataset_sha256": ds_sha,
    "bench_record": "data-scratch/chat-ab/router-raw-01/REPORT.md (ROUTER-RAW-01: raw concat, tuned 0.67; held-out 120 rows recall 0.91, stable 0, no_tool 0, follow-ups 0)",
}
os.makedirs(OUT, exist_ok=True)
body = json.dumps(manifest, separators=(",", ":")).encode()
open(os.path.join(OUT, "search-assist-weights.json"), "wb").write(body)
open(os.path.join(OUT, "search-assist-weights.json.sha256"), "w").write(hashlib.sha256(body).hexdigest() + "  search-assist-weights.json\n")

keep = np.where(~tune)[0]; seq = {}
g = []
for i in keep:
    r = rows[i]; c = r["category"]; seq[c] = seq.get(c, 0) + 1
    e = {"id": f"{c}-held-{seq[c]:03d}", "category": c}
    if r.get("followUp") and c == "no_tool": e["followUp"] = True
    e["alone"] = [round(float(v), 6) for v in Xa[i]]
    if r.get("followUp"): e["pair"] = [round(float(v), 6) for v in Xp[i]]
    g.append(e)
json.dump({"note": "Frozen 768-dim raw nomic vectors for the 120 held-out rows of search-recency-04-labels, scored against the shipped search-assist manifest. Vectors and ids only, no utterances.", "rows": g},
          open(GATE, "w"), separators=(",", ":"))
