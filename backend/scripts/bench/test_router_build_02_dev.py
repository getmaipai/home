"""unittest (pytest is not installed in the bench venv):
  data-scratch/chat-ab/search-recency-04/.venv/bin/python -m unittest backend/scripts/bench/test_router_build_02_dev.py
Uses synthetic embeddings (a fixture cache); no model, no engine."""
import json, os, sys, tempfile, unittest
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import router_build_02_dev as m

DIM = 8


def fixture(n_fam=24, per_fam=3, seed=0):
    """Rows whose vector depends on the class plus per-family noise, so a family is easy to leak and a class is learnable."""
    rng = np.random.default_rng(seed)
    centre = {"recency": np.eye(DIM)[0], "stable": np.eye(DIM)[1], "no_tool": np.eye(DIM)[2]}
    rows, cache = [], {}
    k = 0
    for f in range(n_fam):
        cat = ["recency", "stable", "no_tool"][f % 3]
        fam_noise = rng.normal(0, 0.15, DIM)
        for j in range(per_fam):
            text = f"prompt {f} variant {j}"
            v = centre[cat] * 3 + fam_noise + rng.normal(0, 0.1, DIM)
            cache["\x00" + text] = v / np.linalg.norm(v)
            row = {"id": f"r{k}", "category": cat, "prompt": text, "family": f"fam{f}", "followUp": j == 2 and f % 2 == 0, "band": "adult"}
            if row["followUp"]:
                row["priorUser"], row["priorAssistant"] = "earlier question", "earlier answer"
                cache["\x00" + m.text_of(row)] = cache["\x00" + text]
            rows.append(row)
            k += 1
    return rows, cache


class Helpers(unittest.TestCase):
    def test_threshold_meets_the_false_search_ceiling_and_keeps_most_recall(self):
        p = [0.9, 0.8, 0.7, 0.4, 0.6, 0.3, 0.2, 0.1, 0.05, 0.02]
        y = ["recency"] * 4 + ["stable"] * 3 + ["no_tool"] * 3
        thr = m.pick_threshold_fs(p, y, 0.0)
        self.assertEqual(thr, 0.7)
        self.assertEqual(m.false_rate(p, y, thr, "stable") + m.false_rate(p, y, thr, "no_tool"), 0.0)
        self.assertGreaterEqual(m.recall_at(p, y, thr), 0.75)

    def test_band_holds_at_most_a_quarter_of_the_rows(self):
        p = np.linspace(0, 1, 100)
        y = ["recency" if v > 0.5 else "stable" for v in p]
        low = m.pick_band(p, y, 0.8, 0.25)
        self.assertLessEqual(((p >= low) & (p < 0.8)).mean(), 0.25)
        self.assertGreater(low, 0.5)

    def test_manifest_scores_read_the_shipped_manifest_shape(self):
        man = {"classes": ["no_tool", "recency", "stable"], "coef": [[0, 0], [1, 0], [0, 0]], "intercept": [0, 0, 0]}
        self.assertAlmostEqual(float(m.manifest_scores(man, np.array([[0.0, 0.0]]))[0]), 1 / 3, places=6)
        self.assertGreater(float(m.manifest_scores(man, np.array([[5.0, 0.0]]))[0]), 0.9)

    def test_a_missing_embedding_names_the_fix(self):
        with self.assertRaises(KeyError) as cm:
            m.features([{"prompt": "never embedded"}], {})
        self.assertIn("--embed-missing", str(cm.exception))


class Cv(unittest.TestCase):
    def test_a_family_is_never_on_both_sides_of_a_split(self):
        rows, _ = fixture()
        y = np.array([r["category"] for r in rows]); g = np.array([r["family"] for r in rows])
        for seed in range(3):
            for tr, te in m.grouped_folds(y, g, 5, seed):
                self.assertFalse(set(g[tr]) & set(g[te]))

    def test_nested_cv_runs_for_every_model_type_on_fixture_vectors(self):
        rows, cache = fixture()
        X = m.features(rows, cache)
        y = np.array([r["category"] for r in rows]); g = np.array([r["family"] for r in rows]); fu = np.array([r["followUp"] for r in rows])
        res = m.nested_cv(X, y, g, fu, repeats=1, outer_k=3, inner_k=3, grid={"lr": [1.0], "svm": [0.1], "mlp": [1e-2]})
        self.assertEqual(set(res), {"lr", "svm", "mlp"})
        for kind in res:
            self.assertGreater(res[kind]["recall"], 0.7, kind)
            self.assertEqual(len(res[kind]["folds"]), 3)


class Outputs(unittest.TestCase):
    def test_prereg_records_the_lockbox_hash_and_its_own(self):
        with tempfile.TemporaryDirectory() as d:
            lock = os.path.join(d, "lockbox.json"); open(lock, "w").write('{"rows":[]}')
            cm = os.path.join(d, "c.json")
            json.dump({"thresholds": {"websearch": {"value": 0.61}}}, open(cm, "w"))
            path, digest = m.write_prereg(d, lock, cm, None, None, 2, "ab" * 32)
            doc = json.load(open(path))
            self.assertEqual(doc["lockbox"]["sha256"], m.sha256_file(lock))
            self.assertEqual(doc["deciders"]["C"]["threshold"], 0.61)
            self.assertEqual(doc["marks"]["floor"], 0.91)
            self.assertEqual(digest, m.sha256_file(path))
            self.assertTrue(open(path + ".sha256").read().startswith(digest))


if __name__ == "__main__":
    unittest.main()
