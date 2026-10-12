"""SEARCH-RECENCY-04 (measure only, ships nothing; arm 8 of SEARCH-RECENCY-02): can a small embedding model plus a
linear classifier decide "needs a fresh web search"? Rule 1 forbids a classifier in the turn path; this is a ceiling.

Run with the venv in data-scratch/chat-ab/search-recency-04/.venv:
  .venv/bin/python backend/scripts/bench/search_recency_04.py --out data-scratch/chat-ab/search-recency-04
"""
import argparse, json, os, sys, time, statistics
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict, StratifiedKFold

sys.path.insert(0, os.path.dirname(__file__))
from search_recency_04_score import CATS, split_of, confusion, rates, threshold_predict, pick_threshold, bootstrap_ci

HERE = os.path.dirname(os.path.abspath(__file__))
DS = os.path.join(HERE, "datasets")
NOMIC = "data/models/nomic-embed-text-v1.5.Q4_K_M.gguf"


def load_rows():
    new = json.load(open(os.path.join(DS, "search-recency-04-labels.json")))["rows"]
    orig = json.load(open(os.path.join(DS, "ks-bench-01.json")))["rows"] + json.load(open(os.path.join(DS, "search-recency-02-followups.json")))["rows"]
    return new, orig


def text_of(r):
    if r.get("followUp"):
        return f"Previous question: {r['priorUser']}\nPrevious answer: {r['priorAssistant']}\nNew question: {r['prompt']}"
    return r["prompt"]


class MiniLM:
    name = "minilm"
    def __init__(self):
        from sentence_transformers import SentenceTransformer
        self.m = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu")
    def embed(self, texts):
        return np.asarray(self.m.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False))


class Nomic:
    name = "nomic_home"
    def __init__(self, path):
        from llama_cpp import Llama
        self.m = Llama(model_path=path, embedding=True, verbose=False, n_ctx=2048)
    def embed(self, texts):
        out = []
        for t in texts:
            v = np.asarray(self.m.embed("classification: " + t), dtype=np.float32)
            if v.ndim > 1:
                v = v.mean(axis=0)
            out.append(v / (np.linalg.norm(v) + 1e-9))
        return np.stack(out)


def evaluate(model, new, orig, seeds, cache_dir):
    texts = [text_of(r) for r in new + orig]
    cp = os.path.join(cache_dir, f"emb-{model.name}.npy")
    if os.path.exists(cp):
        X = np.load(cp)
    else:
        X = model.embed(texts)
        np.save(cp, X)
    Xn, Xo = X[: len(new)], X[len(new):]
    yn = np.array([r["category"] for r in new]); yo = np.array([r["category"] for r in orig])
    # latency: one text at a time, embed + predict
    clf0 = LogisticRegression(C=10, max_iter=2000, class_weight="balanced").fit(Xn, yn)
    lat = []
    for t in (texts[i] for i in range(0, len(texts), max(1, len(texts) // 100))):
        s = time.perf_counter(); v = model.embed([t]); clf0.predict_proba(v); lat.append((time.perf_counter() - s) * 1000)
    res = {"latencyMsMedian": statistics.median(lat), "latencyMsP95": sorted(lat)[int(0.95 * len(lat))], "seeds": []}
    pooled = {k: {"held": [], "orig": []} for k in ("argmax", "tuned")}
    detail = None
    for seed in seeds:
        sp = np.array([split_of(r["id"], seed) for r in new])
        tr, he = sp == "tune", sp == "heldout"
        clf = LogisticRegression(C=10, max_iter=2000, class_weight="balanced").fit(Xn[tr], yn[tr])
        cls = list(clf.classes_); ir = cls.index("recency")
        oof = cross_val_predict(LogisticRegression(C=10, max_iter=2000, class_weight="balanced"), Xn[tr], yn[tr], cv=StratifiedKFold(5, shuffle=True, random_state=seed), method="predict_proba")
        thr = pick_threshold(list(oof[:, ir]), list(yn[tr]), 0.9)
        entry = {"seed": seed, "nTune": int(tr.sum()), "nHeld": int(he.sum()), "threshold": thr}
        for set_name, Xe, ye in (("held", Xn[he], yn[he]), ("orig", Xo, yo)):
            P = clf.predict_proba(Xe)
            others = []
            for p in P:
                q = dict(zip(cls, p)); others.append(max(("stable", "no_tool"), key=lambda c: q[c]))
            for mode, t in (("argmax", None), ("tuned", thr)):
                if t is None:
                    pred = [cls[int(np.argmax(p))] for p in P]
                else:
                    pred = threshold_predict(list(P[:, ir]), others, t)
                pooled[mode][set_name].append((list(ye), pred))
                entry[f"{set_name}_{mode}"] = {"rates": rates(list(ye), pred), "confusion": confusion(list(ye), pred)}
        if seed == seeds[0]:
            detail = {"he": he, "clf": clf, "thr": thr}
        res["seeds"].append(entry)
    ci = {}
    for mode in pooled:
        for set_name in ("held", "orig"):
            g = pooled[mode][set_name]
            for k in ("recall", "falseStable", "falseNoTool"):
                ci[f"{set_name}_{mode}_{k}"] = bootstrap_ci(g, lambda a, b, k=k: rates(a, b)[k])
            # adult-only slice of original rows (the 90 adult + 12 follow-ups)
    res["ci"] = ci
    # confusions at seed 0: misclassified held-out and original rows, with nearest opposite-label neighbour
    clf, thr, he = detail["clf"], detail["thr"], detail["he"]
    cls = list(clf.classes_); ir = cls.index("recency")
    allrows = new + orig; XA = X; yA = np.array([r["category"] for r in allrows])
    mis = []
    idx = [i for i in range(len(new)) if he[i]] + [len(new) + j for j in range(len(orig))]
    for i in idx:
        p = clf.predict_proba(XA[i:i + 1])[0]
        pr_recency = p[ir] >= thr
        truth_recency = yA[i] == "recency"
        if pr_recency != truth_recency:
            opp = [k for k in range(len(allrows)) if (yA[k] == "recency") != truth_recency and k != i]
            sims = XA[opp] @ XA[i]; k = opp[int(np.argmax(sims))]
            mis.append({"id": allrows[i]["id"], "truth": yA[i], "text": text_of(allrows[i]).replace("\n", " | "), "pRecency": round(float(p[ir]), 3),
                        "error": "false_search" if pr_recency else "missed_recency", "nearestOpposite": text_of(allrows[k]).replace("\n", " | "), "nearestLabel": yA[k], "sim": round(float(sims.max()), 3)})
    res["misclassifiedSeed0"] = mis
    return res


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--nomic", default=NOMIC); ap.add_argument("--seeds", default="0,1,2")
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    seeds = [int(s) for s in a.seeds.split(",")]
    new, orig = load_rows()
    out = {"nNew": len(new), "nOrig": len(orig), "models": {}}
    models = [MiniLM()]
    if os.path.exists(a.nomic):
        try: models.append(Nomic(a.nomic))
        except Exception as e: out["nomicSkipped"] = str(e)
    for m in models:
        out["models"][m.name] = evaluate(m, new, orig, seeds, a.out)
    json.dump(out, open(os.path.join(a.out, "results.json"), "w"), indent=1, default=float)
    for name, r in out["models"].items():
        print(name, "latency", round(r["latencyMsMedian"], 1), "ms")
        for k, v in r["ci"].items():
            if v: print(" ", k, [round(x, 1) for x in v])

if __name__ == "__main__":
    main()
