import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// COMPOSER-01: happy-dom has no layout engine, so the pixel contract is
// measured in a real browser by `bun run screenshots --composer-layout-review`
// (throws on a violation). These tests pin the declarations that contract
// rests on, so a stylesheet edit cannot quietly drop one.
const css = readFileSync(join(import.meta.dir, "tokens.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};
const SHELL = '[data-slot="next-chat-pane"] [data-slot="aui_composer-shell"]';

describe("composer layout contract (COMPOSER-01)", () => {
  test("the empty composer is one 56px row with a 20px radius", () => {
    const shell = block(SHELL);
    expect(shell).toContain("min-height: 56px");
    expect(shell).toContain("box-sizing: border-box");
    expect(shell).toContain("border-radius: 20px");
  });

  test("controls sit on the bottom row and the text takes its own row when it wraps", () => {
    expect(block(SHELL)).toContain("align-items: end");
    expect(block(`${SHELL}[data-multiline]`)).toContain('"input input input" "lead . trail"');
  });

  test("the text field stops at 160px so the composer tops out near 216px", () => {
    const input = readFileSync(join(import.meta.dir, "../apps/chat/composerDictationWaveform.tsx"), "utf8");
    expect(input).toContain("max-h-40");
    expect(input).toContain("min-h-12");
  });

  test("Send and Stop are 36px, every other round control 32px", () => {
    const wrapper = '[data-slot="next-chat-pane"] .aui-composer-action-wrapper';
    expect(block(`${wrapper} button:where(:not([data-slot="composer-menu-item"]):not([data-slot="model-selector-trigger"]))`)).toContain("width: 32px");
    expect(block(`${wrapper} button[aria-label="Send message"],\n${wrapper} button[aria-label="Stop generating"]`)).toContain("width: 36px");
  });

  test("a phone with the model label puts the text on its own row", () => {
    expect(css).toContain(':has([data-slot="model-selector-trigger"])');
  });
});
