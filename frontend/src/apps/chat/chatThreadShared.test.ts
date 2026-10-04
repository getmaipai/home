import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

// SHARED-THREAD-01: the chat page and the /dev/ui showcase render ONE thread
// composition (apps/chat/ChatThread.tsx), so an Element wired for one is wired
// for the other. These are source-scan guards; ChatThread.test.tsx renders it.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const PAGES = { chat: "../../next/pages/NextChatPage.tsx", showcase: "../../next/pages/NextUiShowcasePage.tsx" } as const;
const KIT_THREAD = /from\s+["']@maipai\/ui\/src\/elements\/thread\.aui["']/;

describe("one chat thread composition", () => {
  test("ChatThread and the element bindings registry exist", () => {
    expect(existsSync(new URL("./ChatThread.tsx", import.meta.url))).toBe(true);
    expect(existsSync(new URL("./elementBindings.ts", import.meta.url))).toBe(true);
  });

  for (const [name, path] of Object.entries(PAGES)) {
    test(`${name} page renders ChatThread`, () => {
      const source = read(path);
      expect(source).toMatch(/import\s*\{[^}]*\bChatThread\b[^}]*\}\s*from\s*["']@\/apps\/chat\/ChatThread["']/);
      expect(source).toContain("<ChatThread");
    });
    test(`${name} page never imports the kit's Thread directly`, () => {
      expect(read(path)).not.toMatch(KIT_THREAD);
    });
  }

  test("the showcase imports no slot component from the chat page", () => {
    const source = read(PAGES.showcase);
    expect(source).not.toMatch(/from\s+["']@\/next\/pages\/NextChatPage["']/);
  });

  test("ChatThread reads the registry and is the only importer of the kit Thread in apps/chat", () => {
    const thread = read("./ChatThread.tsx");
    expect(thread).toMatch(KIT_THREAD);
    expect(thread).toMatch(/from "@\/apps\/chat\/elementBindings"/);
  });

  test("the registry header says how to add an Element and names the adoption scanner", () => {
    const registry = read("./elementBindings.ts");
    expect(registry).toContain("How to add an Element");
    expect(registry).toContain("scripts/elements-adoption.ts");
  });
});
