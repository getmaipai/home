// ROUTER-BUILD-01b: the pinned weights loader. Offline: the downloader is
// injected. Every failure gives a named reason, one Repairs row with a fix
// step, and no throw; a later good load resolves the row.
import { beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIssues } from "@/lib/issues";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadSearchAssistWeights, SEARCH_ASSIST_PIN, type WeightsPin } from "@/lib/searchAssist/weights";
import { resetDb } from "./reset-db";

const FIXTURE = new URL("../src/lib/searchAssist/__fixtures__/weights.json", import.meta.url).pathname;
// sha256 of the fixture file, computed outside this code.
const FIXTURE_SHA = "0cd17824e7857d77328b0f188f8de563861204457d2aa9fdd6e22ad6626fac86";
const EXPECTED = { model: "nomic-embed-text-v1.5.Q4_K_M", dims: 2, preprocess: "v1", prefix: "" };

let dir: string;
beforeEach(() => {
  resetDb();
  dir = mkdtempSync(join(tmpdir(), "search-assist-"));
});

function pin(sha = FIXTURE_SHA): WeightsPin {
  return { file: "weights.json", url: "https://example.com/weights.json", sha256: sha };
}
const place = () => copyFileSync(FIXTURE, join(dir, "weights.json"));
const rows = () => listIssues().filter((i) => i.source === "search-assist");
const noDownload = async () => {
  throw new Error("offline");
};

describe("search assist weights loader", () => {
  test("a good fixture loads and raises nothing", async () => {
    place();
    const r = await loadSearchAssistWeights({ dir, pin: pin(), expected: EXPECTED, download: noDownload });
    expect("missing" in r).toBe(false);
    if (!("missing" in r)) expect(r.features).toBe("concat");
    expect(rows()).toHaveLength(0);
  });

  test("a missing file the downloader cannot fetch is weights_missing with one row and a fix", async () => {
    const r = await loadSearchAssistWeights({ dir, pin: pin(), expected: EXPECTED, download: noDownload });
    expect(r).toEqual({ missing: "weights_missing" });
    const found = rows();
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe("weights_missing");
    expect(found[0]!.title.length).toBeGreaterThan(10);
    expect(found[0]!.detail).toMatch(/\bTry\b|\bCheck\b|\bOpen\b|\bRestart\b/);
    await loadSearchAssistWeights({ dir, pin: pin(), expected: EXPECTED, download: noDownload });
    expect(rows()).toHaveLength(1);
  });

  test("the downloader is asked for the pinned url, destination and checksum", async () => {
    const calls: Array<{ url: string; dest: string; sha: string }> = [];
    await loadSearchAssistWeights({
      dir,
      pin: pin(),
      expected: EXPECTED,
      download: async (url, dest, opts) => {
        calls.push({ url, dest, sha: opts.expectedSha256 });
        copyFileSync(FIXTURE, dest);
      },
    });
    expect(calls).toEqual([{ url: "https://example.com/weights.json", dest: join(dir, "weights.json"), sha: FIXTURE_SHA }]);
  });

  test("a wrong checksum is weights_checksum", async () => {
    place();
    const r = await loadSearchAssistWeights({ dir, pin: pin("f".repeat(64)), expected: EXPECTED, download: noDownload });
    expect(r).toEqual({ missing: "weights_checksum" });
    expect(rows().map((i) => i.key)).toEqual(["weights_checksum"]);
    // The damaged file is gone, so the next load downloads a fresh copy.
    expect(existsSync(join(dir, "weights.json"))).toBe(false);
  });

  test("a file that is not a manifest is weights_checksum, not a throw", async () => {
    writeFileSync(join(dir, "weights.json"), "{ not json");
    const sha = (await Bun.CryptoHasher.hash("sha256", "{ not json", "hex")) as string;
    const r = await loadSearchAssistWeights({ dir, pin: pin(sha), expected: EXPECTED, download: noDownload });
    expect(r).toEqual({ missing: "weights_checksum" });
  });

  test("the shipped pin's sha256 is the bytes of the weights-shipped.json fixture, and that file loads for the real model", async () => {
    const shipped = new URL("../src/lib/searchAssist/__fixtures__/weights-shipped.json", import.meta.url).pathname;
    expect(createHash("sha256").update(readFileSync(shipped)).digest("hex")).toBe(SEARCH_ASSIST_PIN!.sha256);
    copyFileSync(shipped, join(dir, SEARCH_ASSIST_PIN!.file));
    const live = { model: "nomic-embed-text-v1.5.Q4_K_M", dims: 768 };
    expect("missing" in (await loadSearchAssistWeights({ dir, expected: live, download: noDownload }))).toBe(false);
    // The Stack's role alias is not the model: it is rejected.
    expect(await loadSearchAssistWeights({ dir, expected: { ...live, model: "embed" }, download: noDownload })).toEqual({ missing: "embed_mismatch" });
  });

  test("wrong dims, wrong preprocess, wrong model and wrong prefix are each embed_mismatch", async () => {
    place();
    for (const expected of [{ ...EXPECTED, dims: 768 }, { ...EXPECTED, preprocess: "v2" }, { ...EXPECTED, model: "other" }, { ...EXPECTED, prefix: "classification: " }]) {
      const r = await loadSearchAssistWeights({ dir, pin: pin(), expected, download: noDownload });
      expect(r).toEqual({ missing: "embed_mismatch" });
    }
    expect(rows().map((i) => i.key)).toEqual(["embed_mismatch"]);
  });

  test("a later good load resolves the row", async () => {
    await loadSearchAssistWeights({ dir, pin: pin(), expected: EXPECTED, download: noDownload });
    expect(rows()).toHaveLength(1);
    place();
    const r = await loadSearchAssistWeights({ dir, pin: pin(), expected: EXPECTED, download: noDownload });
    expect("missing" in r).toBe(false);
    expect(rows()).toHaveLength(0);
  });

  test("no production pin yet: weights_missing, no throw, no Repairs row to act on", async () => {
    const r = await loadSearchAssistWeights({ dir, pin: null, expected: EXPECTED, download: noDownload });
    expect(r).toEqual({ missing: "weights_missing" });
    expect(rows()).toHaveLength(0);
  });

  test("an unreadable directory never throws", async () => {
    const bad = join(dir, "nope", "deeper");
    mkdirSync(join(dir, "nope"));
    writeFileSync(bad, "a file where a folder should be");
    const r = await loadSearchAssistWeights({ dir: bad, pin: pin(), expected: EXPECTED, download: noDownload });
    expect("missing" in r).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
