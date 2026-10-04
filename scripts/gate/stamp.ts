// GATE-SPEED-01 (b): skip a gate step whose inputs did not change since its
// last green run. A stamp is a content hash (never a timestamp) of every
// file the step reads, stored under the git-ignored data-scratch/. Any change
// to any input, to the tool versions, or to the gate script itself gives a
// different hash and the step runs. When unsure, the step runs.
//
//   bun scripts/gate/stamp.ts check <step> -- <pathspec>...   exit 0 = unchanged since green, skip
//   bun scripts/gate/stamp.ts mark  <step> -- <pathspec>...   record the hash (call only after the step passed)
//
// A pathspec is a git pathspec; prefix one with ":!" to leave a path out of
// the hash (e.g. ":!**/*.test.ts" for a step that never runs tests).
// MAIPAI_GATE_NO_STAMPS=1 makes `check` always fail, so everything runs.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Files that always count as inputs, whatever the step reads. */
export const ALWAYS = ["scripts/check.sh", "scripts/gate/stamp.ts", "bun.lock", "package.json", "backend/package.json", "frontend/package.json"];

/** A file's content hash; a symlink hashes as its target string, a directory or a missing path as a marker. */
function contentId(p: string): string {
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return "absent";
  }
  if (st.isSymbolicLink()) return `link:${readlinkSync(p)}`;
  if (!st.isFile()) return "not-a-file";
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function hashInputs(root: string, pathspecs: string[], extra: Record<string, string> = {}): string {
  const ls = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs, ...ALWAYS], { cwd: root });
  if (ls.exitCode !== 0) throw new Error(`git ls-files failed: ${ls.stderr.toString()}`);
  const files = [...new Set(ls.stdout.toString().split("\0").filter(Boolean))].sort();
  const h = createHash("sha256");
  h.update(`bun ${Bun.version}\n`);
  for (const [k, v] of Object.entries(extra).sort(([a], [b]) => a.localeCompare(b))) h.update(`${k}=${v}\n`);
  for (const f of files) {
    const p = join(root, f);
    h.update(`${f}\0`);
    // A listed-but-missing file (deleted, not yet staged) hashes as absent.
    h.update(contentId(p));
    h.update("\n");
  }
  return h.digest("hex");
}

function stampPath(root: string, step: string): string {
  return join(root, "data-scratch", "gate-stamps", `${step.replace(/[^A-Za-z0-9._-]/g, "_")}.hash`);
}

export function stampMatches(root: string, step: string, hash: string): boolean {
  const p = stampPath(root, step);
  return existsSync(p) && readFileSync(p, "utf8").trim() === hash;
}

export function writeStamp(root: string, step: string, hash: string): void {
  const p = stampPath(root, step);
  mkdirSync(join(root, "data-scratch", "gate-stamps"), { recursive: true });
  writeFileSync(p, `${hash}\n`);
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const [mode, step] = argv;
  const sep = argv.indexOf("--");
  const pathspecs = sep === -1 ? [] : argv.slice(sep + 1);
  if ((mode !== "check" && mode !== "mark") || !step || pathspecs.length === 0) {
    console.error("usage: bun scripts/gate/stamp.ts check|mark <step> -- <pathspec>...");
    process.exit(2);
  }
  const root = resolve(process.env.MAIPAI_GATE_ROOT ?? ".");
  if (mode === "check" && process.env.MAIPAI_GATE_NO_STAMPS === "1") process.exit(1);
  const hash = hashInputs(root, pathspecs);
  if (mode === "mark") {
    writeStamp(root, step, hash);
    process.exit(0);
  }
  process.exit(stampMatches(root, step, hash) ? 0 : 1);
}
