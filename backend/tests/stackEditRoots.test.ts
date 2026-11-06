import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageClipForStack } from "@/lib/videos/stackEdit";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";

let stack: FakeEditStack | null = null;
afterEach(() => { stack?.restore(); stack = null; });

describe("the folders Home opens for the Stack's editor (found 2026-11-06)", () => {
  test("a folder in the Stack's list that no longer exists is dropped, so the edit can still start", async () => {
    stack = installFakeEditStack();
    const keep = mkdtempSync(join(tmpdir(), "stack-root-keep-"));
    const gone = join(tmpdir(), "stack-root-gone-removed-worktree");
    stack.roots.read.push(keep, gone); stack.roots.write.push(keep, gone);
    const source = join(keep, "clip.mp4"); writeFileSync(source, "x");
    const staged = await stageClipForStack(source);
    try {
      expect(staged).not.toBeNull();
      const set = stack.rootsSet.at(-1)!;
      expect(set.read).toContain(keep); expect(set.read).not.toContain(gone);
      expect(set.write).toContain(keep); expect(set.write).not.toContain(gone);
    } finally { staged?.cleanup(); rmSync(keep, { recursive: true, force: true }); }
  });
});
