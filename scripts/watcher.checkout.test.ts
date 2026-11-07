import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fixtures from "./tests/watcherFixtures";

const { fixture, run, commit } = fixtures.createWatcherFixtures();
test("watcher skips a failed checkout without writing green", () => {
  const f = fixture();
  const sha = commit(f, "checkout regression", { "base.txt": "new main\n" });
  const fakeBin = mkdtempSync(join(tmpdir(), "watcher-git-"));
  try {
    writeFileSync(join(fakeBin, "git"), `#!/usr/bin/env bash\nif [[ "$*" == *"checkout --detach"* ]]; then echo 'stub checkout failed' >&2; exit 1; fi\nexec /usr/bin/git "$@"\n`);
    chmodSync(join(fakeBin, "git"), 0o755);
    const out = run(f, "watcher.sh", ["run-once"], { ...f.env, PATH: `${fakeBin}:${process.env.PATH}` });
    expect(out.status).toBe(0);
    expect(readFileSync(join(f.data, "watcher.log"), "utf8")).toContain("not marking green");
    expect(existsSync(join(f.data, "green", sha))).toBe(false);
  } finally { rmSync(fakeBin, { recursive: true, force: true }); }
});
