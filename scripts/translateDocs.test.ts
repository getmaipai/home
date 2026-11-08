import { describe, expect, test } from "bun:test";
import { isTranslationStale, translateDocs } from "./translate-docs";
import type { Completer } from "../backend/src/lib/translate/core";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripted: Completer = async () => ({ ok: true, text: "[]" });
describe("docs translation source freshness", () => {
  test("detects missing, stale and current source hashes", () => {
    const source = "A page";
    const current = "---\nsource_sha256: fbddd8a01bfd546218b58c795fd5f4b9f16b8dfc90ae936b4bcf524abea3afdf\n---\n";
    expect(isTranslationStale(source, null)).toBe(true);
    expect(isTranslationStale(source, current)).toBe(false);
    expect(isTranslationStale("Different", current)).toBe(true);
    expect(scripted).toBeDefined();
  });

  test("preserves markdown keep spans and rejects changed marker counts", async () => {
    const root = mkdtempSync(join(tmpdir(), "translate-docs-"));
    const input = join(root, "docs/user/demo.md");
    mkdirSync(join(root, "docs/user"), { recursive: true });
    mkdirSync(join(root, "frontend/src/locales/es"), { recursive: true });
    writeFileSync(input, "# Demo\n\nOpen [library](library.md) and `Search`.\n\nPress **Saved**.\n");
    writeFileSync(join(root, "frontend/src/locales/glossary.json"), "{}");
    writeFileSync(join(root, "frontend/src/locales/es/messages.po"), 'msgid "Search"\nmsgstr "Buscar"\n');
    let call = 0;
    const completer: Completer = async (messages) => {
      if (messages[0]!.content.startsWith("List names")) return { ok: true, text: "[]" };
      call += 1;
      const batch = JSON.parse(messages[1]!.content) as string[];
      return { ok: true, text: JSON.stringify(batch.map((item, index) => index === 2 ? item.replace(/\*\*/g, "") : item.toUpperCase())) };
    };
    try {
      const result = await translateDocs({ root, locale: "es", date: "2026-11-07", completer });
      expect(result.untranslated).toBe(1);
      const output = readFileSync(join(root, "docs/user/es/demo.md"), "utf8");
      expect(output).toContain("](library.md)");
      expect(output).toContain("`Search`");
      expect(output).toContain("**Saved**.");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
