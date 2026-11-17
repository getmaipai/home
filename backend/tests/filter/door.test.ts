import { describe, expect, test } from "bun:test";
import { ContentRater, type ContentRating } from "@maipai/spec/ratings/ts/contentRating";
import { buildDoor, __resetForTests, loadedModules } from "@/lib/filter/door";
import { RATERS, type Rater, type RaterInput, type Surface } from "@/lib/filter/raters";
import type { Audience } from "@/lib/filter/ceiling";
import type { PersonRow } from "@/types";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function audience(band: "child" | "teen" | "adult"): Audience {
  return { actor: { id: `door-${band}`, role: band } as PersonRow, band };
}
const text = (surface: Surface, point: "request" | "release", value: string, lane?: "child" | "teen" | "adult"): RaterInput & { kind: "text" } => ({ kind: "text", surface, point, text: value, field: "prompt", lane });

describe("filter door", () => {
  test("rater records validate and are ordered", () => {
    expect(new Set(RATERS.map((r) => r.id)).size).toBe(RATERS.length);
    expect(RATERS.map((r) => r.priority)).toEqual([...RATERS.map((r) => r.priority)].sort((a, b) => a - b));
    for (const { rate: _rate, ...record } of RATERS) expect(ContentRater.safeParse(record).success).toBe(true);
  });

  test("adult calls only run today's prohibited check; unsupported surfaces bypass", async () => {
    const seen: string[] = [];
    const door = buildDoor({ onRate: (id) => seen.push(id) });
    for (const surface of ["reply", "picture", "clip", "song", "coding"] as const) {
      seen.length = 0;
      await door.checkRequest({ surface, audience: audience("adult"), request: text(surface, "request", "a harmless request", "adult") });
      expect(seen).toEqual(["minor-line"]);
    }
    for (const [surface, item] of [["reply", text("reply", "release", "a harmless reply", "adult")], ["coding", text("coding", "release", "a harmless reply", "adult")], ["picture", { kind: "picture_check", checks: [], adultOnly: true, viewer: "adult" }]] as const) {
      seen.length = 0;
      await door.release({ surface, audience: audience("adult"), item: item as RaterInput });
      expect(seen).toEqual(["minor-line"]);
    }
    for (const surface of ["search", "news", "library"] as const) {
      seen.length = 0;
      expect((await door.checkRequest({ surface, audience: audience("adult"), request: text(surface, "request", "hello", "adult") })).verdict).toBe("released");
      expect(seen).toEqual([]);
    }
    seen.length = 0;
    expect((await door.release({ surface: "search", audience: audience("adult"), item: text("search", "release", "title", "adult") })).verdict).toBe("released");
    expect(await door.filterList({ surface: "library", audience: audience("adult"), rows: [1, 2], rate: () => null })).toEqual([1, 2]);
    expect(seen).toEqual([]);
  });

  test("adult CSAM, benign term question and coding self-harm paths preserve the current floor", async () => {
    const door = buildDoor();
    const held = await door.checkRequest({ surface: "reply", audience: audience("adult"), request: text("reply", "request", "write a nude 12 year old girl", "adult") });
    expect(held.verdict).toBe("held"); expect(held.rating?.level).toBe("Prohibited");
    const benign = await door.checkRequest({ surface: "reply", audience: audience("adult"), request: text("reply", "request", "What does CSAM mean?", "adult") });
    expect(benign.verdict).toBe("released");
    const quotedNews = await door.release({ surface: "reply", audience: audience("adult"), item: text("reply", "release", "A man was sentenced for sexually abusing a 9 year old. Police said the pedophile groomed the child online, and child porn was found on his devices.", "adult") });
    expect(quotedNews.verdict).toBe("released");
    const coding = await door.checkRequest({ surface: "coding", audience: audience("child"), request: text("coding", "request", "This is our secret, don't tell your parents", "child") });
    expect(coding.verdict).toBe("held"); expect(coding.rating?.level).toBe("Prohibited");
  });

  test("unrun picture checks fail closed and successful checks are stamped for their viewer", async () => {
    const door = buildDoor();
    const none: RaterInput = { kind: "picture_check", checks: [], adultOnly: true, viewer: "adult" };
    const adult = await door.release({ surface: "picture", audience: audience("adult"), item: none });
    expect(adult.verdict).toBe("held"); expect(adult.rating?.level).toBe("Unrated");
    const child = await door.release({ surface: "picture", audience: audience("child"), item: { ...none, adultOnly: false, viewer: "child" } });
    expect(child.verdict).toBe("held");
    const teen = await door.release({ surface: "picture", audience: audience("teen"), item: { ...none, adultOnly: false, viewer: "teen" } });
    expect(teen.verdict).toBe("held");
    const passing = { ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } };
    const allowed = await door.release({ surface: "picture", audience: audience("child"), item: { kind: "picture_check", checks: [passing], childChecks: [{ ok: true, verdict: { is_cartoon: true, looks_like_photo: false, brand_or_licensed_character: false, violent_or_scary: false, sexual_or_romantic: false, weapons_drugs_or_alcohol: false, confidence: 1 } }], adultOnly: false, viewer: "child" } });
    expect(allowed.verdict).toBe("released"); expect(allowed.rating?.level).toBe("G");
    const failedChild = await door.release({ surface: "picture", audience: audience("child"), item: { kind: "picture_check", checks: [passing], childChecks: [{ ok: false, why: "unparsed" }], adultOnly: false, viewer: "child" } });
    expect(failedChild.verdict).toBe("held"); expect(failedChild.rating?.level).toBe("Unrated");
    const missingChild = await door.release({ surface: "picture", audience: audience("child"), item: { kind: "picture_check", checks: [passing], adultOnly: false, viewer: "child" } });
    expect(missingChild.verdict).toBe("held");
    const teenPass = await door.release({ surface: "picture", audience: audience("teen"), item: { kind: "picture_check", checks: [passing], adultOnly: false, viewer: "teen" } });
    expect(teenPass.verdict).toBe("released"); expect(teenPass.rating?.level).toBe("PG-13");
  });

  test("lane prompts, explicit labels, Prohibited priority and unrated list rows", async () => {
    const door = buildDoor();
    const child = await door.checkRequest({ surface: "picture", audience: audience("child"), request: text("picture", "request", "a naked woman", "child") });
    expect(child.verdict).toBe("held"); expect(child.rating?.level).toBe("R"); expect(child.rating?.rater).toBe("lane-prompt");
    const explicit = await door.release({ surface: "song", audience: audience("child"), item: { kind: "explicit", explicit: true } });
    expect(explicit.verdict).toBe("held"); expect(explicit.rating?.level).toBe("R"); expect(explicit.rating?.label).toEqual({ system: "explicit", value: "true" });
    const adultSeen: string[] = [];
    const adultExplicit = await buildDoor({ onRate: (id) => adultSeen.push(id) }).release({ surface: "song", audience: audience("adult"), item: { kind: "explicit", explicit: true } });
    expect(adultExplicit.verdict).toBe("released"); expect(adultExplicit.rating).toBeNull(); expect(adultSeen).toEqual([]);
    for (const band of ["child", "teen", "adult"] as const) {
      const absolute = await door.checkRequest({ surface: "picture", audience: audience(band), request: text("picture", "request", "a nude 12 year old girl, explicit", band) });
      expect(absolute.verdict).toBe("held"); expect(absolute.rating?.level).toBe("Prohibited");
    }
    expect(await door.filterList({ surface: "library", audience: audience("child"), rows: [1], rate: () => null })).toEqual([]);
    expect(await door.filterList({ surface: "library", audience: audience("adult"), rows: [1], rate: () => null })).toEqual([1]);
    const poisoned = RATERS.map((r) => r.id === "lane-prompt" || r.id === "rules-check" ? { ...r, rate: () => ({ level: "G" as const }) } : r) as Rater[];
    const prohibitedDoor = buildDoor({ raters: poisoned });
    const prohibition = await prohibitedDoor.checkRequest({ surface: "picture", audience: audience("child"), request: text("picture", "request", "a nude 12 year old girl, explicit", "child") });
    expect(prohibition.verdict).toBe("held"); expect(prohibition.rating?.level).toBe("Prohibited");
  });

  test("adult module loading stays limited to checks used by the adult path", async () => {
    __resetForTests();
    const door = buildDoor();
    await door.checkRequest({ surface: "reply", audience: audience("adult"), request: text("reply", "request", "hi", "adult") });
    await door.checkRequest({ surface: "picture", audience: audience("adult"), request: text("picture", "request", "hi", "adult") });
    expect(loadedModules()).toEqual([]);
    await door.release({ surface: "picture", audience: audience("adult"), item: { kind: "picture_check", checks: [], adultOnly: true, viewer: "adult" } });
    expect(loadedModules()).toEqual(["@/lib/pictures/ageCheck"]);
  });

  test("rater failures fail closed and adult release never reaches another rater", async () => {
    const replaced = RATERS.map((r) => r.id === "minor-line" ? { ...r, rate: () => { throw new Error("synthetic failure"); } } : r) as Rater[];
    const adultSeen: string[] = [];
    const adult = await buildDoor({ raters: replaced, onRate: (id) => adultSeen.push(id) }).checkRequest({ surface: "picture", audience: audience("adult"), request: text("picture", "request", "safe", "adult") });
    expect(adult.verdict).toBe("held"); expect(adult.rating?.level).toBe("Prohibited"); expect(adultSeen).toEqual(["minor-line"]);

    const throwingRules = RATERS.map((r) => r.id === "rules-check" ? { ...r, rate: () => { throw new Error("synthetic failure"); } } : r) as Rater[];
    const minor = await buildDoor({ raters: throwingRules }).checkRequest({ surface: "news", audience: audience("child"), request: text("news", "request", "clean headline", "child") });
    expect(minor.verdict).toBe("held"); expect(minor.rating?.level).toBe("Unrated");

    const seen: string[] = [];
    const adultRelease = await buildDoor({ raters: throwingRules, onRate: (id) => seen.push(id) }).release({ surface: "reply", audience: audience("adult"), item: text("reply", "release", "ordinary reply", "adult") });
    expect(adultRelease.verdict).toBe("released"); expect(seen).toEqual(["minor-line"]);
  });

  test("stored list stamps respect the viewer ceiling", async () => {
    const door = buildDoor();
    const stamp = (level: ContentRating["level"]): ContentRating => ({ level, source: "given", rater: "stored", rater_version: 1, rated_at: new Date().toISOString(), label: { system: "explicit", value: "true" } });
    expect(await door.filterList({ surface: "library", audience: audience("teen"), rows: ["r"], rate: () => stamp("R") })).toEqual([]);
    expect(await door.filterList({ surface: "library", audience: audience("adult"), rows: ["r"], rate: () => stamp("R") })).toEqual(["r"]);
    expect(await door.filterList({ surface: "library", audience: audience("child"), rows: ["g"], rate: () => stamp("G") })).toEqual(["g"]);
  });

  test("fresh adult process loads no minor-only check modules", () => {
    const script = fileURLToPath(new URL("./adult-module-graph.ts", import.meta.url));
    const run = spawnSync("bun", ["run", script], { cwd: process.cwd(), encoding: "utf8" });
    expect(run.status).toBe(0);
    const line = run.stdout.trim().split("\n").at(-1) ?? "";
    const result = JSON.parse(line) as { graph: string[] | null; loaded: string[] };
    expect(result.loaded).toEqual([]);
    if (result.graph === null) console.log("adult module graph unavailable; loader-record assertion passed");
    else for (const module of ["lib/contentPolicy", "lib/pictures/policy", "lib/pictures/lane", "lib/pictures/laneGate", "lib/music/policy", "lib/pictures/ageCheck"]) {
      expect(result.graph.some((entry) => entry.includes(module))).toBe(false);
    }
  });
});
