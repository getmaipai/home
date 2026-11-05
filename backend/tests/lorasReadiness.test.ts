// STYLES-03: the style base filter follows cached Stack readiness and falls back safely when status is unknown.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { installedBasesNow } from "@/lib/loras/readiness";
import { installableBaseIds, setInstalledBasesProvider, supportedBaseIds, civitaiLabelsFor } from "@/lib/loras/baseFamilies";
import { __resetSourceForTests, __setSourceTestHooks, browseHits, type BrowseParams } from "@/lib/loras/source";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";

const picture = (models: Array<{ id: string; installed: boolean; loras?: boolean }>) => readyStatusForTests({ models: models as never });
const video = (overrides: Parameters<typeof readyVideoStatusForTests>[0] = {}) => readyVideoStatusForTests(overrides);
const ltx25 = (status: ReturnType<typeof readyVideoStatusForTests>, supported: boolean) => ({ ...status, qualities: { ...status.qualities!, ltx25: { ...status.qualities?.ltx25, ready: true, loras: { supported } } } }) as ReturnType<typeof readyVideoStatusForTests>;
const max = (status: ReturnType<typeof readyVideoStatusForTests>, supported: boolean) => ({ ...status, qualities: { ...status.qualities!, ltx25max: { ...status.qualities?.ltx25max, ready: true, loras: { supported } } } }) as ReturnType<typeof readyVideoStatusForTests>;

beforeEach(() => {
  resetDb();
  __resetSourceForTests();
  setInstalledBasesProvider(installedBasesNow);
  setHouseholdSettingValue("generation.styles.civitai", true);
});
afterEach(() => {
  __setVideoStatusForTests(undefined);
  __setPictureStatusForTests(undefined);
  setInstalledBasesProvider(null);
  __resetSourceForTests();
  setHouseholdSettingValue("generation.styles.civitai", false);
});

describe("installed LoRA bases from Stack status", () => {
  test("LTX-2.5 Standard/Boost is included only when the Stack reports LoRAs supported", () => {
    __setVideoStatusForTests(ltx25(video({ ltx25: "ready" }), true));
    __setPictureStatusForTests(picture([]));
    expect(installedBasesNow()).toEqual(new Set(["ltx-2.5"]));
  });

  test("LTX-2.5 and installed Detailed are both included", () => {
    __setVideoStatusForTests(ltx25(video({ detailed: "installed", ltx25: "ready" }), true));
    __setPictureStatusForTests(picture([]));
    expect(installedBasesNow()).toEqual(new Set(["ltx-2.3", "ltx-2.5"]));
  });

  test("Max alone contributes LTX-2.5 when it reports style support", () => {
    __setVideoStatusForTests(max(video({ ltx25max: "ready" }), true));
    __setPictureStatusForTests(picture([]));
    expect(installedBasesNow()).toEqual(new Set(["ltx-2.5"]));
  });

  test("only installed picture models that report LoRA support are included", () => {
    __setVideoStatusForTests(video({ quickMissing: true }));
    __setPictureStatusForTests(picture([
      { id: "flux2-klein-4b", installed: true, loras: true },
      { id: "z-image-turbo", installed: false, loras: true },
      { id: "ernie-image-turbo", installed: true, loras: false },
    ]));
    expect(installedBasesNow()).toEqual(new Set(["flux2-klein-4b"]));
  });

  test("both unknown statuses mean the provider answer is unknown", () => {
    __setVideoStatusForTests(null);
    __setPictureStatusForTests(null);
    expect(installedBasesNow()).toBeNull();
    expect(supportedBaseIds("video")).toEqual(["ltx-2.5", "ltx-2.3"]);
    expect(supportedBaseIds("picture")).toEqual(["flux2-klein-4b", "z-image-turbo", "ernie-image-turbo"]);
  });

  test("one unknown status includes that media while retaining the known media answer", () => {
    __setVideoStatusForTests(video({ quickMissing: true }));
    __setPictureStatusForTests(null);
    expect(installedBasesNow()).toEqual(new Set([...installableBaseIds("picture")]));
    __setVideoStatusForTests(null);
    __setPictureStatusForTests(picture([{ id: "ernie-image-turbo", installed: true, loras: true }]));
    expect(installedBasesNow()).toEqual(new Set(["ltx-2.5", "ltx-2.3", "ernie-image-turbo"]));
  });

  test("default search requests labels only for installed bases, and all labels while status is unknown", async () => {
    const urls: string[] = [];
    __setSourceTestHooks({ gapMs: 0, fetch: (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      urls.push(url.href);
      return Response.json({ items: [], metadata: {} });
    }) as typeof fetch });
    const params: BrowseParams = { source: "civitai", q: "", kind: "any", media: "video", base: "default", sort: "downloads", cursor: null, nsfw: false };
    __setVideoStatusForTests(ltx25(video({ ltx25: "ready" }), true));
    __setPictureStatusForTests(picture([]));
    expect(supportedBaseIds("video")).toEqual(["ltx-2.5"]);
    expect(civitaiLabelsFor("default", "video")).toEqual(["LTXV 2.5", "LTXV2"]);
    await browseHits(params);
    expect(new URL(urls.at(-1)!).searchParams.getAll("baseModels")).toEqual(["LTXV 2.5", "LTXV2"]);

    __setVideoStatusForTests(null);
    __setPictureStatusForTests(null);
    expect(civitaiLabelsFor("default", "video")).toEqual(["LTXV 2.5", "LTXV 2.3", "LTXV2"]);
    await browseHits(params);
    expect(new URL(urls.at(-1)!).searchParams.getAll("baseModels")).toEqual(["LTXV 2.5", "LTXV 2.3", "LTXV2"]);
  });
});
