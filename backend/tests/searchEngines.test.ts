import { describe, expect, test } from "bun:test";
import {
  isPrivacyFlaggedSearchEngine,
  isAdultOnlyImageEngine,
  PRIVACY_FLAGGED_SEARCH_ENGINES,
  ADULT_ONLY_IMAGE_ENGINES,
} from "@/lib/searchEngines";

describe("PRIVACY_FLAGGED_SEARCH_ENGINES", () => {
  test("is a readonly string array of lowercase engine names", () => {
    expect(PRIVACY_FLAGGED_SEARCH_ENGINES).toEqual(["yandex", "yandex images", "baidu", "baidu images"]);
  });
});

describe("ADULT_ONLY_IMAGE_ENGINES", () => {
  test("is a readonly string array of lowercase engine names", () => {
    expect(Array.isArray(ADULT_ONLY_IMAGE_ENGINES)).toBe(true);
    expect(ADULT_ONLY_IMAGE_ENGINES).toEqual(["yandex images", "yandex"]);
  });
});

describe("isPrivacyFlaggedSearchEngine()", () => {
  test("returns true for an exact privacy-flagged engine name", () => {
    expect(isPrivacyFlaggedSearchEngine("yandex")).toBe(true);
    expect(isPrivacyFlaggedSearchEngine("yandex images")).toBe(true);
    expect(isPrivacyFlaggedSearchEngine("baidu")).toBe(true);
    expect(isPrivacyFlaggedSearchEngine("baidu images")).toBe(true);
  });

  test("returns false for an unknown engine name", () => {
    expect(isPrivacyFlaggedSearchEngine("google")).toBe(false);
    expect(isPrivacyFlaggedSearchEngine("bing")).toBe(false);
    expect(isPrivacyFlaggedSearchEngine("duckduckgo")).toBe(false);
    expect(isPrivacyFlaggedSearchEngine("unknown")).toBe(false);
  });

  test("returns false for an empty string", () => {
    expect(isPrivacyFlaggedSearchEngine("")).toBe(false);
  });

  test("is case-insensitive and ignores surrounding whitespace", () => {
    expect(isPrivacyFlaggedSearchEngine("YANDEX")).toBe(true);
    expect(isPrivacyFlaggedSearchEngine("  yandex  ")).toBe(true);
    expect(isPrivacyFlaggedSearchEngine("BaIdU")).toBe(true);
    expect(isPrivacyFlaggedSearchEngine("  Baidu Images  ")).toBe(true);
  });

  test("returns false for a privacy-flagged engine with an extra word appended", () => {
    expect(isPrivacyFlaggedSearchEngine("yandex plus")).toBe(false);
    expect(isPrivacyFlaggedSearchEngine("baidu pro")).toBe(false);
  });

  test("returns false for a privacy-flagged engine with a prefix", () => {
    expect(isPrivacyFlaggedSearchEngine("myyandex")).toBe(false);
    expect(isPrivacyFlaggedSearchEngine("baidu-backup")).toBe(false);
  });
});

describe("isAdultOnlyImageEngine()", () => {
  test("returns true for an exact adult-only image engine name", () => {
    expect(isAdultOnlyImageEngine("yandex images")).toBe(true);
    expect(isAdultOnlyImageEngine("yandex")).toBe(true);
  });

  test("returns false for an unknown engine name", () => {
    expect(isAdultOnlyImageEngine("google")).toBe(false);
    expect(isAdultOnlyImageEngine("bing images")).toBe(false);
    expect(isAdultOnlyImageEngine("duckduckgo")).toBe(false);
    expect(isAdultOnlyImageEngine("unknown")).toBe(false);
  });

  test("returns false for an empty string", () => {
    expect(isAdultOnlyImageEngine("")).toBe(false);
  });

  test("is case-insensitive and ignores surrounding whitespace", () => {
    expect(isAdultOnlyImageEngine("YANDEX IMAGES")).toBe(true);
    expect(isAdultOnlyImageEngine("  yandex  ")).toBe(true);
    expect(isAdultOnlyImageEngine("YaNdEx")).toBe(true);
  });

  test("returns false for an adult-only engine with an extra word appended", () => {
    expect(isAdultOnlyImageEngine("yandex plus")).toBe(false);
    expect(isAdultOnlyImageEngine("yandex pro")).toBe(false);
  });

  test("returns false for an adult-only engine with a prefix", () => {
    expect(isAdultOnlyImageEngine("myyandex")).toBe(false);
    expect(isAdultOnlyImageEngine("yandex-backup")).toBe(false);
  });

  test("returns false for an engine that is privacy-flagged but not in the adult-only list", () => {
    // "baidu" is privacy-flagged but not adult-only
    expect(isAdultOnlyImageEngine("baidu")).toBe(false);
    // "baidu images" is privacy-flagged but not adult-only
    expect(isAdultOnlyImageEngine("baidu images")).toBe(false);
  });

});
