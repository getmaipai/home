"""ROUTER-BUILD-03 (offline, ships nothing): the dev-pool half of ROUTER-BUILD-02. Family-grouped nested CV for the 3-class
classifier C (LR, calibrated linear SVM, 1-hidden-layer MLP) on existing nomic vectors, the threshold at a 2% false-search ceiling,
D's two thresholds, the C weights manifest, decisions for any row file, and PREREG.json. No engine, no Stack call.

  # tune on the dev pool (needs the embedding cache to hold every dev prompt; --embed-missing fills gaps with llama-cpp-python on CPU)
  data-scratch/chat-ab/search-recency-04/.venv/bin/python backend/scripts/bench/router_build_02_dev.py \
      --dev data-scratch/chat-ab/router-build-03/dev.json --cache data-scratch/chat-ab/router-build-03/embcache.npz --out data-scratch/chat-ab/router-build-02/dev
  # score rows with a manifest (A: the shipped head, C: the tuned one), writing {id: SEARCH|NO_SEARCH} and {id: P(recency)}
  ... --decide <rows.json> --manifest <manifest.json> --cache <npz> --out <dir> --tag A
  # write PREREG.json once the choice is made (freezing = committing its sha256 in a docs commit)
  ... --prereg-only --lockbox <lockbox.json> --c-manifest <c-manifest.json> --a-manifest <a-manifest.json> --dev-report <dev-report.json> --b-variant 2 --b-prompt-sha256 <sha> --out <dir>

Features match the shipped head: concat of the raw (no prefix) vector of the prompt and of the pair text. Labels are the final labels
(contested rows excluded). Rows are split only by `family`; repeats use different family shuffles.
"""
import argparse, datetime, hashlib, json, os, sys
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.svm import LinearSVC

sys.path.insert(0, os.path.dirname(__file__))
from search_recency_04 import text_of

CLASSES = ["no_tool", "recency", "stable"]  # sklearn sorts labels, so this is the column order of every model here
FS_CEILING = 0.02
MAX_BAND = 0.25
D_HIGH_FS = 0.005
MARKS = {"floor": 0.91, "diffFloor": 0.2, "followUpFloor": 0.85, "perRepFloor": 0.88, "falseMax": 0.03, "falseUpper": 0.06,
         "falseDiffUpper": 0.03, "noToolFollowUpMax": 1}


# ---------- pure helpers ----------

def sha256_file(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def load_rows(path, only_adult=True):
    rows = json.load(open(path))["rows"]
    return [r for r in rows if (r.get("band", "adult") == "adult" or not only_adult) and not r.get("contested")]


def features(rows, cache, embed=None):
    """concat[raw(prompt), raw(pair text)]. cache keys are '\\x00' + text (the RAW-01 cache); `embed(text)` fills a miss."""
    def vec(t):
        k = "\x00" + t
        if k not in cache:
            if embed is None:
                raise KeyError(f"no cached embedding for a prompt ({t[:40]!r}...). Run again with --embed-missing, or embed the new rows into the cache first.")
            cache[k] = np.asarray(embed(t), dtype=np.float32)
        return np.asarray(cache[k], dtype=np.float64)
    return np.stack([np.hstack([vec(r["prompt"]), vec(text_of(r))]) for r in rows])


def pick_threshold_fs(p_recency, labels, ceiling=FS_CEILING):
    """Lowest threshold (most recall) whose false-search rate over the non-recency rows is at most `ceiling`."""
    p = np.asarray(p_recency, dtype=float)
    neg = np.array([y != "recency" for y in labels])
    if neg.sum() == 0:
        return 0.5
    for t in sorted(set(p.tolist())):
        if (p[neg] >= t).mean() <= ceiling:
            return float(t)
    return float(p.max()) + 1e-9


def recall_at(p_recency, labels, thr):
    pos = np.array([y == "recency" for y in labels])
    return float((np.asarray(p_recency)[pos] >= thr).mean()) if pos.any() else float("nan")


def false_rate(p_recency, labels, thr, cat):
    m = np.array([y == cat for y in labels])
    return float((np.asarray(p_recency)[m] >= thr).mean()) if m.any() else float("nan")


def pick_band(p_recency, labels, high, max_band=MAX_BAND):
    """Lowest `low` (fewest recency rows skipped below it) such that the share of rows in [low, high) is at most `max_band`."""
    p = np.asarray(p_recency, dtype=float)
    best = high
    for low in sorted(set(p[p < high].tolist()), reverse=True):
        if ((p >= low) & (p < high)).mean() <= max_band:
            best = low
        else:
            break
    return float(best)


def make_model(kind, param, seed=0):
    if kind == "lr":
        return LogisticRegression(C=param, max_iter=3000, class_weight="balanced")
    if kind == "svm":
        return CalibratedClassifierCV(LinearSVC(C=param, class_weight="balanced", max_iter=20000), method="sigmoid", cv=3)
    if kind == "mlp":
        return MLPClassifier(hidden_layer_sizes=(64,), alpha=param, max_iter=400, random_state=seed)
    raise ValueError(kind)


GRID = {"lr": [0.1, 1.0, 10.0, 100.0], "svm": [0.01, 0.1, 1.0], "mlp": [1e-4, 1e-2]}


def recency_col(model):
    return list(model.classes_).index("recency")


def grouped_folds(y, groups, k, seed):
    return list(StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=seed).split(np.zeros(len(y)), y, groups))


def oof_recency(kind, param, X, y, groups, k, seed):
    """Out-of-fold P(recency); a family is never on both sides of a split."""
    out = np.zeros(len(y))
    for tr, te in grouped_folds(y, groups, k, seed):
        m = make_model(kind, param, seed).fit(X[tr], y[tr])
        out[te] = m.predict_proba(X[te])[:, recency_col(m)]
    return out


def score_config(p, y):
    thr = pick_threshold_fs(p, y)
    return recall_at(p, y, thr), thr


def nested_cv(X, y, groups, followup, kinds=("lr", "svm", "mlp"), repeats=3, outer_k=5, inner_k=3, grid=None):
    """Outer: grouped 5-fold x `repeats` shuffles. Inner: choose the config and the threshold on the outer-train rows only."""
    grid = grid or GRID
    result = {}
    for kind in kinds:
        folds = []
        for rep in range(repeats):
            for fold, (tr, te) in enumerate(grouped_folds(y, groups, outer_k, rep)):
                best = None
                for param in grid[kind]:
                    p = oof_recency(kind, param, X[tr], y[tr], groups[tr], inner_k, 100 + rep)
                    rec, thr = score_config(p, y[tr])
                    if best is None or rec > best[0]:
                        best = (rec, thr, param)
                _, thr, param = best
                m = make_model(kind, param, rep).fit(X[tr], y[tr])
                pt = m.predict_proba(X[te])[:, recency_col(m)]
                yt = y[te]
                folds.append({"rep": rep, "fold": fold, "param": param, "threshold": thr, "recall": recall_at(pt, yt, thr),
                              "falseStable": false_rate(pt, yt, thr, "stable"), "falseNoTool": false_rate(pt, yt, thr, "no_tool"),
                              "n_recency": int((yt == "recency").sum()),
                              "followUpRecall": recall_at(pt[followup[te]], yt[followup[te]], thr) if (yt[followup[te]] == "recency").any() else None})
        def mean(key):
            v = [f[key] for f in folds if f[key] is not None and not np.isnan(f[key])]
            return float(np.mean(v)) if v else None
        per_rep = {r: float(np.nanmean([f["recall"] for f in folds if f["rep"] == r])) for r in range(repeats)}
        result[kind] = {"recall": mean("recall"), "falseStable": mean("falseStable"), "falseNoTool": mean("falseNoTool"),
                        "followUpRecall": mean("followUpRecall"), "perRepeatRecall": per_rep,
                        "chosenParams": sorted({str(f["param"]) for f in folds}), "folds": folds}
    return result


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def manifest_scores(manifest, X):
    """P(recency) from a search-assist weights manifest (multinomial LR on concat features)."""
    coef = np.asarray(manifest["coef"], dtype=np.float64)
    p = softmax(X @ coef.T + np.asarray(manifest["intercept"], dtype=np.float64))
    return p[:, list(manifest["classes"]).index("recency")]


def build_manifest(model, thr, ds_path):
    return {"embed": {"model": "nomic-embed-text-v1.5.Q4_K_M", "dims": 768, "preprocess": "v1", "prefix": ""},
            "features": "concat", "classes": [str(c) for c in model.classes_],
            "coef": [[round(float(c), 8) for c in row] for row in model.coef_], "intercept": [round(float(c), 8) for c in model.intercept_],
            "thresholds": {"websearch": {"class": "recency", "value": round(float(thr), 6)}},
            "label_spec_version": "router-build-03", "dataset_sha256": sha256_file(ds_path),
            "bench_record": "ROUTER-BUILD-02 dev pool, family-grouped nested CV (LR)"}


def write_prereg(out_dir, lockbox, c_manifest, a_manifest, dev_report, b_variant, b_prompt_sha256):
    c = json.load(open(c_manifest)) if c_manifest else None
    a = json.load(open(a_manifest)) if a_manifest else None
    dr = json.load(open(dev_report)) if dev_report else {}
    doc = {"item": "ROUTER-BUILD-02", "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "note": "Not frozen until this file's sha256 is committed in a docs commit before the lock box runs.",
           "lockbox": {"file": os.path.basename(lockbox), "sha256": sha256_file(lockbox)},
           "deciders": {"A": {"weights_sha256": sha256_file(a_manifest), "threshold": a["thresholds"]["websearch"]["value"]} if a else None,
                        "C": {"weights_sha256": sha256_file(c_manifest), "threshold": c["thresholds"]["websearch"]["value"]} if c else None,
                        "B": {"variant": b_variant, "prompt_sha256": b_prompt_sha256},
                        "D": {"low": dr.get("D", {}).get("low"), "high": dr.get("D", {}).get("high")}},
           "marks": MARKS, "seeds": {"bootstrap": 1, "iterations": 10000}}
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "PREREG.json")
    body = json.dumps(doc, indent=2, sort_keys=True).encode()
    open(path, "wb").write(body)
    digest = hashlib.sha256(body).hexdigest()
    open(path + ".sha256", "w").write(f"{digest}  PREREG.json\n")
    return path, digest


# ---------- CLI ----------

def load_cache(path):
    if os.path.exists(path):
        z = np.load(path, allow_pickle=True)
        return dict(zip(z["k"].tolist(), z["v"]))
    return {}


def save_cache(path, cache):
    np.savez(path, k=np.array(list(cache), dtype=object), v=np.stack(list(cache.values())))


def make_embedder(model_path):
    from llama_cpp import Llama  # CPU, in-process; never the Stack
    m = Llama(model_path=model_path, embedding=True, verbose=False, n_ctx=2048, n_threads=2, n_threads_batch=2)
    def embed(t):
        v = np.asarray(m.embed(t), dtype=np.float32)
        if v.ndim > 1:
            v = v.mean(axis=0)
        return v / (np.linalg.norm(v) + 1e-9)
    return embed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev"); ap.add_argument("--cache"); ap.add_argument("--out", required=True)
    ap.add_argument("--embed-missing", action="store_true"); ap.add_argument("--nomic", default="data/models/nomic-embed-text-v1.5.Q4_K_M.gguf")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--decide"); ap.add_argument("--manifest"); ap.add_argument("--tag", default="C")
    ap.add_argument("--prereg-only", action="store_true"); ap.add_argument("--lockbox"); ap.add_argument("--c-manifest"); ap.add_argument("--a-manifest")
    ap.add_argument("--dev-report"); ap.add_argument("--b-variant", type=int, default=2); ap.add_argument("--b-prompt-sha256", default="")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    if a.prereg_only:
        if not a.lockbox:
            sys.exit("--prereg-only needs --lockbox <path>. Example: --lockbox /full/path/lockbox.json")
        path, digest = write_prereg(a.out, a.lockbox, a.c_manifest, a.a_manifest, a.dev_report, a.b_variant, a.b_prompt_sha256)
        print(path, digest)
        return

    cache = load_cache(a.cache)
    embed = make_embedder(a.nomic) if a.embed_missing else None
    before = len(cache)

    if a.decide:
        rows = load_rows(a.decide, only_adult=False)
        manifest = json.load(open(a.manifest))
        X = features(rows, cache, embed)
        p = manifest_scores(manifest, X)
        thr = manifest["thresholds"]["websearch"]["value"]
        json.dump({r["id"]: float(v) for r, v in zip(rows, p)}, open(os.path.join(a.out, f"scores-{a.tag}.json"), "w"))
        json.dump({r["id"]: ("SEARCH" if v >= thr else "NO_SEARCH") for r, v in zip(rows, p)}, open(os.path.join(a.out, f"decisions-{a.tag}.json"), "w"))
        if embed and len(cache) > before:
            save_cache(a.cache, cache)
        print(f"{a.tag}: {len(rows)} rows scored at threshold {thr}")
        return

    rows = load_rows(a.dev)
    X = features(rows, cache, embed)
    if embed and len(cache) > before:
        save_cache(a.cache, cache)
    y = np.array([r["category"] for r in rows])
    fam = np.array([r["family"] for r in rows])
    fu = np.array([bool(r.get("followUp")) for r in rows])
    nested = nested_cv(X, y, fam, fu, repeats=a.repeats)
    best_kind = max(nested, key=lambda k: nested[k]["recall"])
    # Final config: non-nested grouped CV over the whole dev pool for the winner, threshold on its out-of-fold scores.
    cand = [(score_config(oof_recency(best_kind, prm, X, y, fam, 5, 7), y)[0], prm) for prm in GRID[best_kind]]
    param = max(cand)[1]
    oof = oof_recency(best_kind, param, X, y, fam, 5, 7)
    thr = pick_threshold_fs(oof, list(y))
    high = pick_threshold_fs(oof, list(y), D_HIGH_FS)
    low = pick_band(oof, list(y), high)
    model = make_model(best_kind, param, 0).fit(X, y)
    report = {"rows": len(rows), "families": len(set(fam.tolist())), "nested": {k: {kk: vv for kk, vv in v.items() if kk != "folds"} for k, v in nested.items()},
              "winner": {"kind": best_kind, "param": param, "threshold": thr, "oofRecall": recall_at(oof, y, thr), "oofFalseStable": false_rate(oof, y, thr, "stable"), "oofFalseNoTool": false_rate(oof, y, thr, "no_tool")},
              "D": {"low": low, "high": high, "bandShare": float(((oof >= low) & (oof < high)).mean()), "belowLowRecencyShare": float((oof[y == "recency"] < low).mean())}}
    json.dump(report, open(os.path.join(a.out, "dev-report.json"), "w"), indent=2)
    json.dump({r["id"]: float(v) for r, v in zip(rows, oof)}, open(os.path.join(a.out, "dev-oof-scores.json"), "w"))
    if best_kind == "lr":
        mp = os.path.join(a.out, "c-manifest.json")
        open(mp, "w").write(json.dumps(build_manifest(model, thr, a.dev), separators=(",", ":")))
        report["manifest"] = mp
    else:
        report["manifest"] = None
        report["note"] = f"{best_kind} won; the shipped head loads only a linear manifest, so shipping it needs a loader change. The dev-oof scores and thresholds above are still valid for a ceiling."
        json.dump(report, open(os.path.join(a.out, "dev-report.json"), "w"), indent=2)
    print(json.dumps(report["winner"]), json.dumps(report["D"]))


if __name__ == "__main__":
    main()
