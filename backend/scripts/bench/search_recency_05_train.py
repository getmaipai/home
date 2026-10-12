"""SEARCH-RECENCY-05 (measure only, ships nothing): train the SEARCH classifier on the tune split of
search-recency-04-labels.json only, with three follow-up feature sets, and write per-row decisions for the
132 original bench rows plus a small JSON of weights.
  .venv/bin/python backend/scripts/bench/search_recency_05_train.py --out data-scratch/chat-ab/search-recency-05
Feature sets: pair (prior question + answer + new question, as SEARCH-RECENCY-04), alone (new question only),
concat ([alone, pair]). The arm uses concat; the other two are reported offline."""
import argparse, json, os, sys, time
import numpy as np
from sklearn.linear_model import LogisticRegression
sys.path.insert(0, os.path.dirname(__file__))
from search_recency_04 import NOMIC, Nomic, text_of, load_rows
from search_recency_04_score import rates, bootstrap_ci

def alone(r): return r["prompt"]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); a = ap.parse_args()
    new, orig = load_rows()
    m = Nomic(NOMIC)
    rows = new + orig
    Ep = m.embed([text_of(r) for r in rows]); Ea = m.embed([alone(r) for r in rows])
    feats = {"pair": Ep, "alone": Ea, "concat": np.hstack([Ea, Ep])}
    y = np.array([r["category"] for r in rows]); n = len(new)
    tune = np.array([r["split"] == "tune" for r in new]); held = ~tune
    fu = np.array([bool(r.get("followUp")) for r in rows])
    out = {"nTune": int(tune.sum()), "variants": {}}
    dec = {}
    for name, X in feats.items():
        clf = LogisticRegression(C=10, max_iter=3000, class_weight="balanced").fit(X[:n][tune], y[:n][tune])
        cls = list(clf.classes_)
        pred = np.array(clf.predict(X))
        res = {}
        def slice_rates(mask, label):
            yt, yp = list(y[mask]), list(pred[mask]); res[label] = {"n": int(mask.sum()), **rates(yt, yp)}
        idx_new = np.arange(len(rows)) < n
        idx_held = np.concatenate([held, np.zeros(len(orig), bool)])
        idx_orig = ~idx_new
        slice_rates(idx_held, "held_all"); slice_rates(idx_held & fu, "held_followups"); slice_rates(idx_held & ~fu, "held_standalone")
        slice_rates(idx_orig, "orig_all"); slice_rates(idx_orig & fu, "orig_followups"); slice_rates(idx_orig & ~fu, "orig_standalone")
        # no_tool followup false searches counted directly
        for lab, mask in (("held", idx_held), ("orig", idx_orig)):
            mk = mask & fu & (y == "no_tool")
            res[f"{lab}_notool_followup_false_search"] = {"n": int(mk.sum()), "k": int((pred[mk] == "recency").sum())}
        res["cis"] = {f"{lab}_{k}": bootstrap_ci([(list(y[mask]), list(pred[mask]))], lambda aa, bb, k=k: rates(aa, bb)[k]) for lab, mask in (("held", idx_held), ("orig", idx_orig)) for k in ("recall", "falseStable", "falseNoTool")}
        out["variants"][name] = res
        dec[name] = {r["id"]: ("SEARCH" if p == "recency" else "NO_SEARCH") for r, p in zip(orig, pred[n:])}
        if name == "concat":
            w = {"classes": cls, "coef": clf.coef_.round(5).tolist(), "intercept": clf.intercept_.round(5).tolist(), "embedder": "nomic-embed-text-v1.5.Q4_K_M, prefix 'classification: ', L2-normalised, features [alone, pair]", "trainedOn": "search-recency-04-labels.json split=tune only (%d rows)" % int(tune.sum())}
            json.dump(w, open(os.path.join(a.out, "classifier-weights.json"), "w"))
            lat = []
            for r in rows[::4]:
                s = time.perf_counter(); ea = m.embed([alone(r)]); ep = m.embed([text_of(r)]); clf.predict_proba(np.hstack([ea, ep])); lat.append((time.perf_counter() - s) * 1000)
            out["concatLatencyMsMedian"] = float(np.median(lat))
    json.dump(dec, open(os.path.join(a.out, "decisions.json"), "w"), indent=1)
    json.dump(out, open(os.path.join(a.out, "offline.json"), "w"), indent=1, default=float)
    for name, res in out["variants"].items():
        print(name)
        for k, v in res.items():
            if k != "cis": print("  ", k, v)
    print("latency", out["concatLatencyMsMedian"])
if __name__ == "__main__": main()
