"""Guards of scripts/local-land.py. Run: python3 -m unittest scripts/local_land_test.py"""
import importlib.util, os, subprocess, tempfile, unittest

spec = importlib.util.spec_from_file_location("local_land", os.path.join(os.path.dirname(__file__), "local-land.py"))
ll = importlib.util.module_from_spec(spec); spec.loader.exec_module(ll)


class Guard(unittest.TestCase):
    def repo(self):
        d = tempfile.mkdtemp()
        sh = lambda *c: subprocess.run(c, cwd=d, capture_output=True, check=True)
        sh("git", "init", "-q", "-b", "main"); sh("git", "config", "user.email", "t@example.com"); sh("git", "config", "user.name", "t")
        open(d + "/a.txt", "w").write("1"); sh("git", "add", "a.txt"); sh("git", "commit", "-qm", "1"); sh("git", "update-ref", "refs/remotes/origin/main", "HEAD")
        return d

    def write(self, d, path, text="x"):
        os.makedirs(os.path.dirname(os.path.join(d, path)), exist_ok=True); open(os.path.join(d, path), "w").write(text)

    def test_plain_change_passes_and_committed_work_counts(self):
        d = self.repo(); self.write(d, "docs/dev/x.md")
        self.assertEqual(ll.guard(d), (["docs/dev/x.md"], None))
        subprocess.run(["git", "-C", d, "add", "."], check=True); subprocess.run(["git", "-C", d, "commit", "-qm", "m"], check=True)
        self.assertEqual(ll.guard(d), (["docs/dev/x.md"], None))

    def test_nothing_protected_many_and_big_are_refused(self):
        d = self.repo(); self.assertIn("nothing", ll.guard(d)[1])
        for bad in ("backend/src/lib/codeGate.ts", "package.json", "scripts/check.sh", "docs/design/RULES.md", "backend/src/lib/auth.ts", ".env.local"):
            e = self.repo(); self.write(e, bad); self.assertIn("protected", ll.guard(e)[1], bad)
        e = self.repo()
        for i in range(13): self.write(e, "docs/f%d.md" % i)
        self.assertIn("13 files", ll.guard(e)[1])
        e = self.repo(); self.write(e, "docs/big.md", "line\n" * 800); self.assertIn("lines", ll.guard(e)[1])

    def test_data_scratch_is_ignored(self):
        d = self.repo(); self.write(d, "data-scratch/notes.md"); self.assertIn("nothing", ll.guard(d)[1])


if __name__ == "__main__":
    unittest.main()
