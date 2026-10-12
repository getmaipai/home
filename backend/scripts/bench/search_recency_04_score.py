"""SEARCH-RECENCY-04 scorer (measurement only, ships nothing). Pure stdlib, no engine, no embedder.

Label space: recency (needs a fresh web search), stable, no_tool. A prediction of "recency" means SEARCH.
"""
import hashlib
import random

CATS = ("recency", "stable", "no_tool")


def split_of(row_id: str, seed: int = 0, tune_pct: int = 60) -> str:
    """Hash-of-id split. Seed 0 hashes the bare id (the split stored in the dataset)."""
    key = row_id if seed == 0 else f"{seed}:{row_id}"
    return "tune" if int(hashlib.sha256(key.encode()).hexdigest(), 16) % 100 < tune_pct else "heldout"


def confusion(labels, preds):
    m = {a: {b: 0 for b in CATS} for a in CATS}
    for y, p in zip(labels, preds):
        m[y][p] += 1
    return m


def rates(labels, preds):
    """recall of recency, false-search rate on stable and on no_tool (None when the class is empty)."""
    out = {}
    for name, cat in (("recall", "recency"), ("falseStable", "stable"), ("falseNoTool", "no_tool")):
        rows = [p for y, p in zip(labels, preds) if y == cat]
        if not rows:
            out[name] = None
            continue
        hit = sum(1 for p in rows if p == "recency")
        out[name] = 100.0 * (hit if cat == "recency" else hit) / len(rows)
    return out


def threshold_predict(p_recency, others, threshold):
    """SEARCH iff P(recency) >= threshold; otherwise the more likely of the other classes."""
    return ["recency" if p >= threshold else o for p, o in zip(p_recency, others)]


def pick_threshold(p_recency, labels, target_recall=0.9):
    """Highest threshold whose recall on these (out-of-fold) rows still reaches target_recall."""
    pos = sorted((p for p, y in zip(p_recency, labels) if y == "recency"), reverse=True)
    if not pos:
        return 0.5
    k = max(1, int(-(-target_recall * len(pos) // 1)))  # ceil
    return pos[min(k, len(pos)) - 1]


def bootstrap_ci(groups, metric, n_boot=2000, seed=7):
    """95% percentile interval. groups = list of (labels, preds) per seed; rows resampled within each group,
    metric computed on the pooled resample. Returns (mean, low, high) or None when metric undefined."""
    rng = random.Random(seed)
    vals = []
    for _ in range(n_boot):
        L, P = [], []
        for labels, preds in groups:
            n = len(labels)
            for _i in range(n):
                j = rng.randrange(n)
                L.append(labels[j])
                P.append(preds[j])
        v = metric(L, P)
        if v is not None:
            vals.append(v)
    if not vals:
        return None
    vals.sort()
    lo = vals[int(0.025 * len(vals))]
    hi = vals[min(len(vals) - 1, int(0.975 * len(vals)))]
    return sum(vals) / len(vals), lo, hi
