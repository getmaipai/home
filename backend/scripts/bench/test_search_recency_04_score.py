import os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
from search_recency_04_score import split_of, confusion, rates, threshold_predict, pick_threshold, bootstrap_ci


class Score(unittest.TestCase):
    def test_split_is_deterministic_and_roughly_sixty_forty(self):
        ids = [f"row-{i}" for i in range(2000)]
        a = [split_of(i) for i in ids]
        self.assertEqual(a, [split_of(i) for i in ids])
        tune = a.count("tune") / len(a)
        self.assertTrue(0.55 < tune < 0.65)
        self.assertNotEqual(a, [split_of(i, seed=1) for i in ids])

    def test_rates_recall_and_false_search(self):
        y = ["recency", "recency", "stable", "stable", "no_tool", "no_tool"]
        p = ["recency", "stable", "recency", "stable", "no_tool", "recency"]
        r = rates(y, p)
        self.assertEqual(r["recall"], 50.0)
        self.assertEqual(r["falseStable"], 50.0)
        self.assertEqual(r["falseNoTool"], 50.0)

    def test_rates_empty_class_is_none(self):
        self.assertIsNone(rates(["recency"], ["recency"])["falseStable"])

    def test_confusion_counts(self):
        m = confusion(["recency", "stable"], ["stable", "stable"])
        self.assertEqual(m["recency"]["stable"], 1)
        self.assertEqual(m["stable"]["stable"], 1)

    def test_threshold_predict(self):
        self.assertEqual(threshold_predict([0.9, 0.2], ["stable", "no_tool"], 0.5), ["recency", "no_tool"])

    def test_pick_threshold_reaches_target_recall(self):
        p = [0.9, 0.8, 0.7, 0.6, 0.5, 0.1, 0.2]
        y = ["recency"] * 5 + ["stable"] * 2
        t = pick_threshold(p, y, 0.8)
        self.assertEqual(t, 0.6)
        pred = threshold_predict(p, ["stable"] * 7, t)
        self.assertGreaterEqual(rates(y, pred)["recall"], 80.0)

    def test_bootstrap_interval_brackets_mean(self):
        y = ["recency"] * 20 + ["stable"] * 20
        p = ["recency"] * 15 + ["stable"] * 5 + ["stable"] * 20
        mean, lo, hi = bootstrap_ci([(y, p)], lambda a, b: rates(a, b)["recall"], n_boot=300)
        self.assertLessEqual(lo, 75.0)
        self.assertGreaterEqual(hi, 75.0)
        self.assertLess(lo, hi)


if __name__ == "__main__":
    unittest.main()
