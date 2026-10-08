import { expect, test } from "bun:test";

const tokens = await Bun.file(new URL("./settingsTokens.css", import.meta.url)).text();

test("settings content and row text tokens give notification rows room", () => {
  expect(tokens).toMatch(/--settings-content-max:\s*1080px/);
  expect(tokens).toMatch(/--settings-row-text-max:\s*560px/);
});
