"""ROUTER-RAW-01 (offline, ships nothing): search classifier on raw (no prefix) nomic vectors vs prefixed.
  data-scratch/chat-ab/search-recency-04/.venv/bin/python backend/scripts/bench/router_raw_01.py --out data-scratch/chat-ab/router-raw-01"""
import argparse, json, os, sys, time
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict, StratifiedKFold
sys.path.insert(0, os.path.dirname(__file__))
from search_recency_04 import NOMIC, text_of, load_rows
from search_recency_04_score import rates, pick_threshold, threshold_predict
from llama_cpp import Llama

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); a = ap.parse_args()
    m = Llama(model_path=NOMIC, embedding=True, verbose=False, n_ctx=2048, n_threads=2, n_threads_batch=2)
    cache_path = os.path.join(a.out, "embcache.npz"); cache = {}
    if os.path.exists(cache_path):
        z = np.load(cache_path, allow_pickle=True); cache = dict(zip(z["k"].tolist(), z["v"]))
    lat_log = {}
    def emb(t, pre):
        k = pre + "\x00" + t
        if k not in cache:
            s0 = time.perf_counter(); cache[k] = emb_raw(t, pre); lat_log.setdefault(pre, []).append((time.perf_counter() - s0) * 1000)
            if len(cache) % 50 == 0: np.savez(cache_path, k=np.array(list(cache), dtype=object), v=np.stack(list(cache.values())))
        return cache[k]
    def emb_raw(t, pre):
        v = np.asarray(m.embed(pre + t), dtype=np.float32)
        if v.ndim > 1: v = v.mean(axis=0)
        return v / (np.linalg.norm(v) + 1e-9)
    new, orig = load_rows(); rows = new + orig; n = len(new)
    y = np.array([r["category"] for r in rows]); fu = np.array([bool(r.get("followUp")) for r in rows])
    tune = np.array([r["split"] == "tune" for r in new]); held = ~tune
    idx_held = np.concatenate([held, np.zeros(len(orig), bool)]); idx_orig = np.arange(len(rows)) >= n
    out = {}
    for pname, pre in (("raw", ""), ("classification", "classification: ")):
        Ea = np.stack([emb(r["prompt"], pre) for r in rows]); Ep = np.stack([emb(text_of(r), pre) for r in rows])
        np.savez(cache_path, k=np.array(list(cache), dtype=object), v=np.stack(list(cache.values())))
        lat = lat_log.get(pre) or [float("nan")]
        feats = {"alone": Ea, "pair": Ep, "concat": np.hstack([Ea, Ep])}
        out[pname] = {"embedMsMedian": float(np.median(lat)), "embedMsP95": float(np.percentile(lat, 95))}
        for fname, X in feats.items():
            mk = lambda: LogisticRegression(C=10, max_iter=3000, class_weight="balanced")
            clf = mk().fit(X[:n][tune], y[:n][tune]); cls = list(clf.classes_); ir = cls.index("recency")
            oof = cross_val_predict(mk(), X[:n][tune], y[:n][tune], cv=StratifiedKFold(5, shuffle=True, random_state=0), method="predict_proba")
            thr = pick_threshold(list(oof[:, ir]), list(y[:n][tune]), 0.9)
            P = clf.predict_proba(X); others = [max(("stable", "no_tool"), key=lambda c: dict(zip(cls, p))[c]) for p in P]
            res = {"threshold": float(thr)}
            for mode in ("argmax", "tuned"):
                pred = np.array([cls[int(np.argmax(p))] for p in P]) if mode == "argmax" else np.array(threshold_predict(list(P[:, ir]), others, thr))
                d = {}
                for lab, mask in (("held", idx_held), ("orig132", idx_orig), ("orig_followups", idx_orig & fu)):
                    d[lab] = {"n": int(mask.sum()), **rates(list(y[mask]), list(pred[mask]))}
                    nt = mask & (y == "no_tool") & fu
                    d[lab]["notoolFollowupFalseSearch"] = f"{int((pred[nt]=='recency').sum())}/{int(nt.sum())}"
                res[mode] = d
            out[pname][fname] = res
        json.dump(out, open(os.path.join(a.out, 'results.json'), 'w'), indent=1)
    json.dump(out, open(os.path.join(a.out, "results.json"), "w"), indent=1)

main()
