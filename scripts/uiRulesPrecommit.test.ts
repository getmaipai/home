import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PRECOMMIT-RULES-01: the hook script, end to end, in a scratch git repo with
// empty baselines: a seeded violation is rejected with a message, a clean tree
// passes, and the documented skip works.
const REPO = join(import.meta.dir, "..");
let dir = "";
const run = (cmd: string[], env: Record<string, string> = {}) =>
  Bun.spawnSync(cmd, { cwd: dir, env: { ...process.env, ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" }, stdout: "pipe", stderr: "pipe" });
const hook = (env: Record<string, string> = {}) => {
  const r = run(["bash", "scripts/ui-rules-precommit.sh"], env);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};
const stage = (rel: string, body: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body);
  run(["git", "add", rel]);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "uirules-"));
  mkdirSync(join(dir, "frontend/src"), { recursive: true });
  mkdirSync(join(dir, "frontend/src/apps/chat"), { recursive: true });
  mkdirSync(join(dir, "docs/design"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(join(REPO, "frontend/src/dev"), join(dir, "frontend/src/dev"), { recursive: true, filter: (s) => !/\.test\.tsx?$/.test(s) && !s.includes("ElementsAdoptionPanel") });
  for (const f of readdirSync(join(REPO, "frontend/src/dev")).filter((f) => f.endsWith(".test.ts") && /^(kitElementLints|handBuiltChat)/.test(f))) cpSync(join(REPO, "frontend/src/dev", f), join(dir, "frontend/src/dev", f));
  for (const b of ["kit-classname-override-baseline", "kit-css-override-baseline", "kit-wrapper-baseline"]) writeFileSync(join(dir, `frontend/src/dev/${b}.json`), "{}");
  writeFileSync(join(dir, "frontend/src/dev/hand-built-chat-baseline.json"), "{}");
  // GATE-FIX-04: ELEMENTS-LINT-03 reads the chat's element registry for
  // rule 9(b)'s registered-render exception (RULES-EDIT-01); the scratch
  // repo needs one, empty, or the lint fails on a missing file.
  writeFileSync(join(dir, "frontend/src/apps/chat/elementBindings.ts"), "export const TOOL_BINDINGS = [];\nexport const DATA_BINDINGS = [];\n");
  cpSync(join(REPO, "docs/design/ELEMENTS-DECISIONS.md"), join(dir, "docs/design/ELEMENTS-DECISIONS.md"));
  cpSync(join(REPO, "frontend/package.json"), join(dir, "frontend/package.json"));
  cpSync(join(REPO, "frontend/bunfig.toml"), join(dir, "frontend/bunfig.toml"));
  cpSync(join(REPO, "frontend/tests"), join(dir, "frontend/tests"), { recursive: true });
  cpSync(join(REPO, "scripts/ui-rules-precommit.sh"), join(dir, "scripts/ui-rules-precommit.sh"));
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  symlinkSync(join(REPO, "frontend/node_modules"), join(dir, "frontend/node_modules"));
  run(["git", "init", "-q"]);
  run(["git", "add", "."]);
  run(["git", "commit", "-qm", "base"]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("scripts/ui-rules-precommit.sh", () => {
  test("a backend-only or docs-only commit is not checked at all", () => {
    stage("backend/x.ts", "export const x = 1;\n");
    expect(hook()).toEqual({ code: 0, out: "" });
    run(["git", "reset", "-q"]);
  });

  test("a clean frontend change passes", () => {
    stage("frontend/src/shell/Clean.tsx", `import { Button } from "@maipai/ui/src/ui/button";\nexport const kit = { Button };\n`);
    expect(hook().code).toBe(0);
    run(["git", "reset", "-q"]);
  });

  test("a className override on a kit part is rejected with the file, element and the remedy", () => {
    stage("frontend/src/shell/Seed.tsx", `import { Button } from "@maipai/ui/src/ui/button";\nexport const Seed = () => <Button className="rounded-full p-4">x</Button>;\n`);
    const r = hook();
    expect(r.code).toBe(1);
    expect(r.out).toContain("commit refused");
    expect(r.out).toContain("shell/Seed.tsx");
    expect(r.out).toContain("<Button>");
    expect(r.out).toContain("Use the Element as it ships");
    run(["git", "reset", "-q"]);
    rmSync(join(dir, "frontend/src/shell/Seed.tsx"));
  });

  test("a new wrapper around a kit Element is rejected", () => {
    stage("frontend/src/shell/SeedPanel.tsx", `import { Card } from "@maipai/ui/src/dashboard/components/ui/card";\nexport function SeedPanel() { return <Card />; }\n`);
    const r = hook();
    expect(r.code).toBe(1);
    expect(r.out).toContain("SeedPanel");
    expect(r.out).toContain("wrapper");
    run(["git", "reset", "-q"]);
    rmSync(join(dir, "frontend/src/shell/SeedPanel.tsx"));
  });

  test("a baseline that grew is rejected before the scan", () => {
    stage("frontend/src/dev/kit-wrapper-baseline.json", JSON.stringify({ "next/a.tsx": { NewPanel: { ed: "NO-REASON-REMOVE", reason: "NO REASON: x" } } }));
    const r = hook();
    expect(r.code).toBe(1);
    expect(r.out).toContain("grew");
    expect(r.out).toContain("NewPanel");
    run(["git", "reset", "-q"]);
    run(["git", "checkout", "--", "frontend/src/dev/kit-wrapper-baseline.json"]);
  });

  test("the documented skip lets the hook pass, and says so", () => {
    stage("frontend/src/shell/Seed2.tsx", `import { Button } from "@maipai/ui/src/ui/button";\nexport const S = () => <Button className="rounded-full">x</Button>;\n`);
    const r = hook({ MAIPAI_SKIP_UI_RULES: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("the gate still runs it");
  });
});

describe("scripts/install-hooks.sh", () => {
  const repo = (withScript: boolean) => {
    const d = mkdtempSync(join(tmpdir(), "uihook-"));
    mkdirSync(join(d, "scripts"), { recursive: true });
    cpSync(join(REPO, "scripts/install-hooks.sh"), join(d, "scripts/install-hooks.sh"));
    if (withScript) writeFileSync(join(d, "scripts/ui-rules-precommit.sh"), "exit 1\n");
    const sh = (...c: string[]) => Bun.spawnSync(c, { cwd: d, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" }, stdout: "pipe", stderr: "pipe" });
    sh("git", "init", "-q");
    sh("bash", "scripts/install-hooks.sh");
    writeFileSync(join(d, "a.txt"), "a\n");
    if (withScript) rmSync(join(d, "scripts/install-hooks.sh"));
    sh("git", "add", "a.txt");
    return { d, sh };
  };

  test("a commit succeeds in a tree that has no scripts/ui-rules-precommit.sh", () => {
    const { d, sh } = repo(false);
    expect(sh("git", "commit", "-qm", "x").exitCode).toBe(0);
    rmSync(d, { recursive: true, force: true });
  });

  test("a tree that has the script runs it, and its failure blocks the commit", () => {
    const { d, sh } = repo(true);
    expect(sh("git", "commit", "-qm", "x").exitCode).toBe(1);
    rmSync(d, { recursive: true, force: true });
  });

  test("it repairs the older failing form and stays idempotent", () => {
    const d = mkdtempSync(join(tmpdir(), "uihook-"));
    const sh = (...c: string[]) => Bun.spawnSync(c, { cwd: d, stdout: "pipe", stderr: "pipe" });
    mkdirSync(join(d, "scripts"));
    cpSync(join(REPO, "scripts/install-hooks.sh"), join(d, "scripts/install-hooks.sh"));
    sh("git", "init", "-q");
    writeFileSync(join(d, ".git/hooks/pre-commit"), "#!/usr/bin/env bash\n# maipai ui-rules\n[ -f scripts/ui-rules-precommit.sh ] && { bash scripts/ui-rules-precommit.sh || exit 1; }\n");
    sh("bash", "scripts/install-hooks.sh");
    const once = Bun.file(join(d, ".git/hooks/pre-commit")).text();
    return once.then(async (a) => {
      expect(a).toContain("exit 0");
      expect(a).not.toContain("&& {");
      sh("bash", "scripts/install-hooks.sh");
      expect(await Bun.file(join(d, ".git/hooks/pre-commit")).text()).toBe(a);
      rmSync(d, { recursive: true, force: true });
    });
  });
});
