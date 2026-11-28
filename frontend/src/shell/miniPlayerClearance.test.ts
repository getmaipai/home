import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

test("mini player and minimize control clear the phone navigation", () => {
  const phoneBlock = css.match(/@media\s*\(max-width:\s*639\.98px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  expect(phoneBlock).toContain('html:has([data-slot="phone-nav"]) [data-slot="global-mini-player"]');
  expect(phoneBlock).toContain("bottom: calc(49px + env(safe-area-inset-bottom));");
  expect(phoneBlock).toContain('html:has([data-slot="phone-nav"]):has([data-slot="global-mini-player"]) [data-slot="rail-body"]');
  expect(phoneBlock).toContain("padding-bottom: calc(7rem + env(safe-area-inset-bottom));");
});

test("desktop mini player floats centered at the bottom", () => {
  const source = readFileSync(new URL("./GlobalMiniPlayer.tsx", import.meta.url), "utf8");
  expect(source).toContain("md:start-1/2");
  expect(source).toContain("md:-translate-x-1/2");
  expect(source).toContain("md:w-[min(690px,calc(100vw-7rem))]");
  expect(source).toContain("md:pb-[10px]");
});
