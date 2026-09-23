import { describe, test, expect } from "bun:test";
import { classifyScope } from "./gateScope";

describe("classifyScope", () => {
  test("a frontend-only change scopes to frontend", () => {
    const result = classifyScope(["frontend/src/apps/chat/chatHeaderBar.tsx", "frontend/src/apps/chat/chatHeaderBar.test.tsx"]);
    expect(result.scope).toBe("frontend");
  });

  test("a backend-only change scopes to backend", () => {
    const result = classifyScope(["backend/src/routes/turn.ts", "backend/tests/turnMachine/turnNext.test.ts"]);
    expect(result.scope).toBe("backend");
  });

  test("a docs-only change scopes to docs", () => {
    const result = classifyScope(["docs/BACKLOG.md", "docs/dev.md"]);
    expect(result.scope).toBe("docs");
  });

  test("root README/AGENTS/CLAUDE/LICENSE files scope to docs, not full", () => {
    const result = classifyScope(["README.md", "AGENTS.md", "CLAUDE.md", "LICENSE", "NOTICE", "CHANGELOG.md"]);
    expect(result.scope).toBe("docs");
  });

  test("a bundled package's own README.md is a backend file, not a doc", () => {
    // hashPackageDir() (backend/src/lib/bundledPackages.ts) hashes every
    // file in a bundled package, README.md included - a docs-scoped
    // gate would never run package-bronze.test.ts's own check on it.
    const result = classifyScope(["backend/packages/bronze/README.md"]);
    expect(result.scope).toBe("backend");
  });

  test("docs/api/ is a backend concern (the drift check that catches a hand edit)", () => {
    const result = classifyScope(["docs/api/openapi.json"]);
    expect(result.scope).toBe("backend");
  });

  test(".claude/ scopes to docs (no check in the gate reads it)", () => {
    const result = classifyScope([".claude/settings.json"]);
    expect(result.scope).toBe("docs");
  });

  test("frontend and backend together crosses packages, so full", () => {
    const result = classifyScope(["frontend/src/apps/chat/chatHeaderBar.tsx", "backend/src/routes/turn.ts"]);
    expect(result.scope).toBe("full");
    expect(result.why).toContain("crosses packages");
  });

  test("a root package.json or bun.lock change forces full", () => {
    expect(classifyScope(["bun.lock"]).scope).toBe("full");
    expect(classifyScope(["package.json"]).scope).toBe("full");
    expect(classifyScope(["frontend/package.json"]).scope).toBe("full");
    expect(classifyScope(["backend/package.json"]).scope).toBe("full");
  });

  test("a root scripts/ change forces full, but backend/scripts or frontend/scripts do not", () => {
    expect(classifyScope(["scripts/screenshot.ts"]).scope).toBe("full");
    expect(classifyScope(["backend/scripts/bench/query-rewrite.ts"]).scope).toBe("backend");
    expect(classifyScope(["frontend/scripts/generate-icons.ts"]).scope).toBe("frontend");
  });

  test("a spec/ workspace path forces full", () => {
    // home has no spec/ workspace today (this repo's own; commons has
    // the real one) - dead code on this repo as of this landing, kept
    // and tested for the day home/spec/ (the org's own product table
    // references home/spec/design/ historically) exists again.
    const result = classifyScope(["spec/settings/keys.json"]);
    expect(result.scope).toBe("full");
    expect(result.why).toContain("spec workspace");
  });

  test("a rename across packages (old backend path gone, new frontend path added) is seen as both, so full", () => {
    // check.sh's own diff uses --no-renames for exactly this reason -
    // this test proves the classifier's own side of that contract: fed
    // both halves of a rename as two plain paths, it still goes full.
    const result = classifyScope(["backend/src/lib/oldHelper.ts", "frontend/src/lib/oldHelper.ts"]);
    expect(result.scope).toBe("full");
  });

  test("a backend change to a file frontend/ imports directly forces full", () => {
    const result = classifyScope(["backend/src/wire.ts"], ["backend/src/wire", "backend/src/homeCardQuestions"]);
    expect(result.scope).toBe("full");
    expect(result.why).toContain("backend/src/wire.ts");
  });

  test("a backend change to an unrelated file stays backend scope even when other files are frontend-imported", () => {
    const result = classifyScope(["backend/src/routes/turn.ts"], ["backend/src/wire", "backend/src/homeCardQuestions"]);
    expect(result.scope).toBe("backend");
  });

  test("the direct-import escalation still matches when either side carries a .js/.jsx extension", () => {
    // Today's import specifiers are extension-free
    // (`@maipai/home-backend/src/wire`), but a future Node16/nodenext-
    // style import could write the compiled `.js` extension against a
    // `.ts` source - the match has to survive either side gaining one.
    expect(classifyScope(["backend/src/wire.ts"], ["backend/src/wire.js"]).scope).toBe("full");
    expect(classifyScope(["backend/src/wire.js"], ["backend/src/wire"]).scope).toBe("full");
  });

  test("an empty diff (clean tree) runs the full gate to verify the full state", () => {
    const result = classifyScope([]);
    expect(result.scope).toBe("full");
  });

  test("classifyScope has no concept of tracked vs untracked - it classifies whatever list it's given", () => {
    // Which files land in that list - a stray untracked file from
    // another session in a shared checkout must never widen a run,
    // but a brand-new file with nothing else tracked-changed must
    // still classify narrowly, not fall back to full - is check.sh's
    // own compute_scope() job, not this function's, and is proven
    // against real git and real bash in scripts/checkScope.test.ts
    // (getmaipai/home#144's own fix included), not here.
    const result = classifyScope(["frontend/src/apps/chat/newPanel.tsx"]);
    expect(result.scope).toBe("frontend");
  });

  test("a path matching no known bucket forces full rather than silently narrowing", () => {
    const result = classifyScope(["some-new-root-file.txt"]);
    expect(result.scope).toBe("full");
    expect(result.why).toContain("unclassified");
  });

  test("docs mixed into a package diff doesn't widen or narrow the package's own scope", () => {
    const result = classifyScope(["frontend/src/apps/chat/chatHeaderBar.tsx", "docs/dev.md"]);
    expect(result.scope).toBe("frontend");
  });
});
