import { expect, test } from "bun:test";
import { fallbackChain, SUPPORTED_LOCALES } from "./supportedLocales";
import { languageName } from "@/lib/format";

test("supported locale names and fallback chains are stable", () => {
  expect(SUPPORTED_LOCALES).toEqual(["en-US", "en-GB", "es"]);
  expect(languageName("es")).toBe("Español");
  expect(fallbackChain("en-GB")).toEqual(["en-GB", "en-US"]);
  expect(fallbackChain("es")).toEqual(["es", "en-US"]);
  expect(fallbackChain("es", "child")).toEqual(["es-x-child", "es", "en-US"]);
});
