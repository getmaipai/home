import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ELT-COMPOSER-KIT-01: the compact composer layout (48px row, 30px controls,
// 32px Send, 48px hit areas, the wrapped-text row, the 160px field cap) lives
// in the kit's `composerDensity: "compact"` (thread-composer.css), and the
// pixel contract is measured in a real browser by
// `bun run screenshots --composer-layout-review`. Home only selects the
// variant and sets colour tokens, so these tests pin that Home carries no
// structural rule against the kit's composer.
const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8");
const tokens = read("tokens.css");
const touchTargets = read("../next/pages/nextChatTouchTargets.css");

describe("composer in Home (ELT-COMPOSER-KIT-01)", () => {
  test("the chat selects the kit's compact composer density", () => {
    expect(read("../apps/chat/elementBindings.ts")).toMatch(/composerDensity:\s*"compact"/);
  });

  test("Home's CSS holds no selector against the kit's composer markup", () => {
    for (const css of [tokens, touchTargets]) {
      expect(css).not.toContain("aui_composer-shell");
      expect(css).not.toContain("aui-composer-");
      expect(css).not.toContain("model-selector-trigger");
    }
  });

  test("Home only sets the kit's size and colour tokens for the composer", () => {
    const start = tokens.indexOf('[data-slot="next-chat-pane"] {\n  --composer-compact-row-height');
    expect(start).toBeGreaterThan(-1);
    const block = tokens.slice(start, tokens.indexOf("}", start));
    const declarations = block.split("\n").filter((line) => line.includes(":")).map((line) => line.trim().split(":")[0]!.replace("{", "").trim());
    expect(declarations.filter((name) => name.startsWith("--composer-compact-"))).toEqual([
      "--composer-compact-row-height",
      "--composer-compact-control-size",
      "--composer-compact-send-size",
      "--composer-compact-inset-y",
      "--composer-compact-inset-start",
      "--composer-compact-inset-end",
      "--composer-compact-bg",
      "--composer-compact-border",
      "--composer-compact-border-focus",
    ]);
    expect(block).not.toMatch(/(^|\n)\s*(width|height|min-height|padding|display|border-radius|grid-template-areas)\s*:/);
  });

  test("COMPOSER-SIZE-01: the empty row is 50px outer with a 48px field, 30px controls and a 32px Send", () => {
    const value = (name: string) => tokens.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1];
    expect(value("--composer-compact-row-height")).toBe("50");
    expect(value("--composer-compact-control-size")).toBe("30");
    expect(value("--composer-compact-send-size")).toBe("32");
    expect(value("--composer-compact-inset-y")).toBe("0");
  });

  test("the Add menu and the text field pass no sizing class to kit parts", () => {
    expect(read("../apps/chat/composerAddMenu.tsx")).not.toContain("before:-inset");
    const waveform = read("../apps/chat/composerDictationWaveform.tsx");
    expect(waveform).toContain("ComposerInputField");
    expect(waveform).not.toContain("data-multiline");
    expect(waveform).not.toContain("max-h-");
  });
});
