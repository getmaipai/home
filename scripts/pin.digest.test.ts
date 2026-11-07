import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("pin refuses the empty file digest", () => {
  const repo = mkdtempSync(join(tmpdir(), "pin-empty-digest-"));
  try {
    const init = spawnSync("git", ["init", "-b", "wt/test", repo], { encoding: "utf8" });
    expect(init.status).toBe(0);
    mkdirSync(join(repo, "backend"), { recursive: true }); mkdirSync(join(repo, "frontend"), { recursive: true });
    writeFileSync(join(repo, "backend/package.json"), '{"dependencies":{"@maipai/ui":"file:../../commons-tags/ui-ui-v1.0.0/ui"}}\n');
    writeFileSync(join(repo, "frontend/package.json"), '{"dependencies":{"@maipai/ui":"file:../../commons-tags/ui-ui-v1.0.0/ui"}}\n');
    mkdirSync(join(repo, "scripts/engine-computer"), { recursive: true });
    writeFileSync(join(repo, "scripts/install.sh"), 'commons_archive_sha256() {\n  case "$1" in\n    *) return 1 ;;\n  esac\n}\n');
    writeFileSync(join(repo, "scripts/engine-computer/maipai-engine"), 'commons_archive_sha256() {\n  case "$1" in\n    *) return 1 ;;\n  esac\n}\n');
    const out = spawnSync("bash", [join(import.meta.dir, "pin.sh"), "commons", "ui-v9.9.9", "--no-land"], {
      cwd: repo, encoding: "utf8", env: { ...process.env, MAIPAI_PIN_SHA256_CMD: "printf e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", MAIPAI_PIN_ENSURE_TAG_CMD: "true" },
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("empty file");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
