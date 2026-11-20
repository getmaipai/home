// VF-MINOR-RECIPE-01 (Home half, SHADOW): for a fixed set of 40 requests a young person might make, compare what Home sends TODAY for a child's clip (the child lane of runGenerateVideo, the old door)
// against the request Home WOULD send the Stack's generic door (minorClipRequestFor). Nothing in Home calls minorClipRequestFor at run time; a child's behavior does not change. The comparison proves:
// the person's own words are the description untouched; only keys the Stack allows a minor appear; no picture, negative words, model, size or tier ever ride; the rating comes from the ceiling (a teen is not
// a child); a request Home refuses today is never turned into a door request (the door is only asked after Home's own gates); today's cartoon wording and negative list are the ones this comparison pins.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { CHILD_NEGATIVE_PROMPT, CHILD_PROMPT_PREFIX, forceCartoon } from "@/lib/pictures/lane";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { MINOR_CLIP_KEYS, MINOR_DESCRIPTION_MAX, minorClipRequestFor, minorRatingOf } from "@/lib/videos/minorClip";
import { __setVideosFetchForTests, minorClipRatings } from "@/lib/videos/stack";
import { resetDb } from "./reset-db";
import { installFakeVideoStack } from "./videoFixture";
import { createBenchPeople } from "../scripts/bench/conversationRunner";

const words = (JSON.parse(readFileSync(new URL("./fixtures/child-request-words.json", import.meta.url), "utf8")) as { requests: string[] }).requests;
let fake: ReturnType<typeof installFakeVideoStack>;
beforeEach(() => {
  resetDb(); createBenchPeople(); fake = installFakeVideoStack();
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 30)); fake.restore(); });

function child() {
  const now = new Date().toISOString(), id = "person-minorshadow";
  if (!db.select().from(people).where(eq(people.id, id)).get()) db.insert(people).values({ id, displayName: "Sprout", role: "child", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as ReturnType<typeof createBenchPeople>["owner"];
}
async function makeAsChild(prompt: string) {
  const actor = child();
  const result = await runGenerateVideo({ state: { actor, temporary: false, conversationId: null, turnId: null }, args: { prompt }, callId: "c", spoken: false, audience: { actor, band: "child", surface: "chat", surfaceClass: "written", spoken: false } as never });
  await new Promise((r) => setTimeout(r, 120));
  return { result, sent: fake.submitted.at(-1) ?? null };
}

describe("what Home sends a child today against what it would send the door (40 requests)", () => {
  test("today: every request that is made carries the cartoon prefix and the child's negative words; every request Home refuses sends nothing", async () => {
    let made = 0, refused = 0;
    for (const prompt of words) {
      resetDb(); createBenchPeople(); fake.restore(); fake = installFakeVideoStack();
      __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
      const { result, sent } = await makeAsChild(prompt);
      if (sent) {
        made++;
        expect(String(sent.prompt)).toBe(forceCartoon(prompt));
        expect(String(sent.prompt).startsWith(CHILD_PROMPT_PREFIX)).toBe(true);
        expect(sent.negative_prompt).toBe(CHILD_NEGATIVE_PROMPT);
        expect(sent.audience).toBe("all-ages");
      } else { refused++; expect((result.result?.data as { refused?: string } | undefined)?.refused ?? result.status).toBeTruthy(); }
    }
    expect(made + refused).toBe(words.length);
    expect(made).toBeGreaterThan(20);   // most ordinary requests are made; the refusals are Home's own and stay Home's
  }, 120_000);

  test("the door request for each of the 40: the child's words as they are, G for a child's ceiling, only the Stack's allowed keys, nothing that loosens", () => {
    for (const prompt of words) {
      const request = minorClipRequestFor({ words: prompt, size: "832x480", seconds: 5, seed: 7, ceiling: 0 }) as unknown as Record<string, unknown> | null;
      if (prompt.length > MINOR_DESCRIPTION_MAX) { expect(request).toBeNull(); continue; }
      expect(request).not.toBeNull();
      expect(request).toMatchObject({ job: "clip", audience: "minor", rating: "G", description: prompt.trim(), shape: "landscape", level: "standard", seconds: 5, seed: 7 });
      for (const key of Object.keys(request!)) expect(MINOR_CLIP_KEYS.has(key)).toBe(true);
      for (const key of ["negative_prompt", "negative", "prompt_mode", "image", "start_picture", "end_picture", "model", "size", "tier", "inputs", "operation", "loras", "styles"]) expect(request).not.toHaveProperty(key);
    }
  });

  test("a teen's ceiling is sent as PG-13 (never as G, so a teen is not made a cartoon), a raised child's ceiling follows it, and an adult's is not a minor request", () => {
    expect(minorRatingOf(0)).toBe("G");
    expect(minorRatingOf(1)).toBe("PG-13");
    expect(minorRatingOf(2)).toBe("PG-13");
    expect(minorRatingOf(3)).toBeNull();
    expect(minorRatingOf(4)).toBeNull();
    expect(minorClipRequestFor({ words: "a boat", size: "832x480", seconds: 5, ceiling: 2 })).toMatchObject({ rating: "PG-13" });
    expect(minorClipRequestFor({ words: "a boat", size: "832x480", seconds: 5, ceiling: 4 })).toBeNull();
  });

  test("anything that would loosen or is not plain keeps the clip on the old door: a picture, negative words, a style, a model, a longer idea, no size", () => {
    const base = { words: "a boat", size: "832x480", seconds: 5, ceiling: 0 as const };
    for (const extras of [{ image: "AAAA" }, { end_image: "AAAA" }, { negative_prompt: "x" }, { loras: [{ id: "lora-aaaaaaaa", strength: 1 }] }, { model: "m" }, { source_video: "/x.mp4" }, { tier: "boost" }]) expect(minorClipRequestFor({ ...base, extras })).toBeNull();
    expect(minorClipRequestFor({ ...base, extras: { loras: [] } })).not.toBeNull();   // an empty list is nothing
    expect(minorClipRequestFor({ ...base, words: "x".repeat(MINOR_DESCRIPTION_MAX + 1) })).toBeNull();
    expect(minorClipRequestFor({ ...base, words: "   " })).toBeNull();
    expect(minorClipRequestFor({ ...base, size: undefined })).toBeNull();
    expect(minorClipRequestFor({ ...base, seconds: 0 })).toBeNull();
  });

  test("Home's cartoon instruction is the one the Stack's G recipe starts with (when the Stack's checkout is beside this one)", () => {
    const recipe = new URL("../../../stack/backend/src/packs/ltx-2-5-q8-distilled-mlx/recipes/clip.child-g.md", import.meta.url);
    if (!existsSync(recipe)) return;
    const text = readFileSync(recipe, "utf8");
    expect(text).toContain(CHILD_PROMPT_PREFIX.replace(/: $/, ":"));
  });

  test("the Stack's minor list: no clip entry today means the door is not asked; a listed rating means it would be", async () => {
    __setVideosFetchForTests((async (input: string | URL | Request) => {
      const url = new URL(String(input), "http://stack.test");
      if (url.pathname === "/stack/v1/jobs/catalog" && url.searchParams.get("audience") === "minor") return new Response(JSON.stringify({ audience: "minor", jobs: [{ job: "picture", available: true }] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch);
    expect(await minorClipRatings()).toBeNull();
    __setVideosFetchForTests((async () => new Response(JSON.stringify({ audience: "minor", jobs: [{ job: "clip", available: true, minor_ratings: ["G", "PG-13"] }] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch);
    expect(await minorClipRatings()).toEqual(["G", "PG-13"]);
    __setVideosFetchForTests(null);
  });
});
