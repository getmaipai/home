import { expect, test } from "bun:test";
import { fallbackChain, LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from "./supportedLocales";

test("supported locale names and fallback chains are stable", () => {
  expect(SUPPORTED_LOCALES).toEqual(["en-US", "en-GB", "es"]);
  expect(LOCALE_DISPLAY_NAMES.es).toBe("Español");
  expect(fallbackChain("en-GB")).toEqual(["en-GB", "en-US"]);
  expect(fallbackChain("es")).toEqual(["es", "en-US"]);
  expect(fallbackChain("es", "child")).toEqual(["es-x-child", "es", "en-US"]);
});
