import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

test("mini player and minimize control clear the phone navigation", () => {
  const phoneBlock = css.match(/@media\s*\(max-width:\s*639\.98px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  expect(phoneBlock).toContain('html:has([data-slot="phone-nav"]) [data-slot="global-mini-player"]');
  expect(phoneBlock).toContain("bottom: calc(5rem + env(safe-area-inset-bottom));");
  expect(phoneBlock).toContain('html:has([data-slot="phone-nav"]):has([data-slot="global-mini-player"]) [data-slot="rail-body"]');
  expect(phoneBlock).toContain("padding-bottom: 9rem;");
});
