// Unit tests for lib/routing.ts (session-c-brain-and-voice.md step 1).
// End-to-end routing behavior (precedence, the anti-hijack fix) is
// covered by turnEngine.test.ts and routingCorpus.test.ts; this file is
// the store and the scoring/decision primitives on their own.
import { describe, test, expect, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { routingEmbeddings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  ensureRoutingEmbeddings,
  embedUtterance,
  scoreByEmbedding,
  pickTier1Winner,
  pickTier1WinnerAmong,
  TIER1_THRESHOLD,
  TIER1_MARGIN,
} from "@/lib/routing";

beforeEach(() => {
  resetDb();
});

function rowsFor(packageId: string) {
  return db.select().from(routingEmbeddings).where(eq(routingEmbeddings.packageId, packageId)).all();
}

describe("ensureRoutingEmbeddings()", () => {
  test("embeds every example for a package with none stored yet", async () => {
    await ensureRoutingEmbeddings([{ id: "test-pkg", examples: ["hello world", "good morning"] }]);
    expect(rowsFor("test-pkg")).toHaveLength(2);
  });

  test("an unchanged example is a pure lookup, not a re-embed - same hlc on the second call", async () => {
    await ensureRoutingEmbeddings([{ id: "test-pkg", examples: ["hello world"] }]);
    const first = rowsFor("test-pkg");
    expect(first).toHaveLength(1);
    const firstHlc = first[0]!.hlc;

    await ensureRoutingEmbeddings([{ id: "test-pkg", examples: ["hello world"] }]);
    const second = rowsFor("test-pkg");
    expect(second).toHaveLength(1);
    expect(second[0]!.hlc).toBe(firstHlc); // untouched: the exists-check found it and skipped it entirely
  });

  test("a changed example re-embeds under a new hash, without deleting the old row", async () => {
    await ensureRoutingEmbeddings([{ id: "test-pkg", examples: ["hello world"] }]);
    expect(rowsFor("test-pkg")).toHaveLength(1);

    await ensureRoutingEmbeddings([{ id: "test-pkg", examples: ["hello universe"] }]);
    const rows = rowsFor("test-pkg");
    expect(rows).toHaveLength(2); // the old hash's row is still there, orphaned but harmless
    expect(rows.map((r) => r.example).sort()).toEqual(["hello universe", "hello world"]);
  });

  test("a candidate with no examples is simply skipped, no error", async () => {
    await ensureRoutingEmbeddings([{ id: "test-pkg", examples: undefined }]);
    expect(rowsFor("test-pkg")).toHaveLength(0);
  });
});

describe("embedUtterance()", () => {
  test("returns a real vector for real text", async () => {
    const v = await embedUtterance("what's the weather in Seattle");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v!.length).toBeGreaterThan(0);
  });

  test("returns undefined rather than throwing when embed() itself rejects the input - the exact 'fall back to keyword overlap' signal callers key off", async () => {
    // lib/llm.ts's embed() rejects an empty string as invalid_input; this
    // is the one real, deterministic way to make the embed call fail
    // without a mocking layer this codebase doesn't otherwise use
    // (memory.test.ts's own "embed backend down" tests take the same
    // shape: exercise the real failure contract, not a faked-up one).
    const v = await embedUtterance("");
    expect(v).toBeUndefined();
  });
});

describe("scoreByEmbedding()", () => {
  test("scores an unambiguous match well above an unrelated candidate", async () => {
    await ensureRoutingEmbeddings([
      { id: "weather-like", examples: ["what's the weather in Seattle", "weather in Denver"] },
      { id: "joke-like", examples: ["tell me a dad joke", "got any jokes"] },
    ]);
    const v = await embedUtterance("what's the weather in Seattle");
    const scores = scoreByEmbedding(v!, ["weather-like", "joke-like"]);
    // Fix D (docs/dev.md's 2026-09-07 incident note): ensureRoutingEmbeddings()
    // now prefixes the STORED (document) side with "search_document: ";
    // embedUtterance()'s own query side is deliberately left unprefixed
    // (that file's own header comment has the measured reasoning). Real
    // asymmetric-prefix models are trained so the two still align well
    // despite the mismatch - the stub's own bag-of-words scorer isn't:
    // "search"/"document" are two extra tokens diluting the stored
    // vector's sum that the plain query text never had to begin with, so
    // an identical phrase on both sides no longer lands as close to 1.0
    // as it did when both sides were the same literal string. The real
    // behavior this test cares about - a genuine match reads far higher
    // than an unrelated one - is exactly what the second assertion below
    // still proves; `toBeCloseTo(1.0, 1)` was asserting the stub's own
    // exact-string-match artifact, not real routing behavior.
    expect(scores.get("weather-like")!).toBeGreaterThan(0.8);
    expect(scores.get("weather-like")!).toBeGreaterThan(scores.get("joke-like") ?? 0);
  });

  test("a candidate with no stored rows is absent from the result, not scored 0", async () => {
    await ensureRoutingEmbeddings([{ id: "has-rows", examples: ["hello world"] }]);
    const v = await embedUtterance("hello world");
    const scores = scoreByEmbedding(v!, ["has-rows", "no-rows-at-all"]);
    expect(scores.has("has-rows")).toBe(true);
    expect(scores.has("no-rows-at-all")).toBe(false);
  });
});

describe("pickTier1Winner()", () => {
  test("fires when the top score clears the threshold with nothing else in contention", () => {
    expect(pickTier1Winner([{ id: "a", score: TIER1_THRESHOLD }])).toEqual({ id: "a", score: TIER1_THRESHOLD });
  });

  test("never fires below the threshold, even alone", () => {
    expect(pickTier1Winner([{ id: "a", score: TIER1_THRESHOLD - 0.01 }])).toBeNull();
  });

  test("the live-found bug this step exists to fix: two close scores from shared filler words never fire, however high", () => {
    // Both comfortably clear TIER1_THRESHOLD on their own - the old
    // per-candidate check ("does this ONE candidate clear 0.6") would
    // have fired the higher of the two outright. The margin is what
    // makes "close together" distinguishable from "a real match."
    const scores = [
      { id: "joke", score: 0.7 },
      { id: "storytime-style", score: 0.7 + TIER1_MARGIN - 0.01 },
    ];
    expect(pickTier1Winner(scores)).toBeNull();
  });

  test("fires for the top candidate once the margin is real", () => {
    const scores = [
      { id: "joke", score: TIER1_THRESHOLD },
      { id: "storytime-style", score: TIER1_THRESHOLD + TIER1_MARGIN + 0.01 },
    ];
    expect(pickTier1Winner(scores)?.id).toBe("storytime-style");
  });

  test("an empty candidate list never fires", () => {
    expect(pickTier1Winner([])).toBeNull();
  });
});

describe("pickTier1WinnerAmong()", () => {
  // The exact live-found bug (2026-09-06 code review): route()'s first
  // cut returned null for the WHOLE turn the instant the top scorer
  // couldn't bind its required arg (weather/recall/remember/define all
  // need one, and a fuzzy match never has a wildcard capture to bind it
  // with), silently dropping a perfectly good arg-free runner-up (joke,
  // trivia, a skill) that had also cleared the bar.
  test("skips a winner that can't fire and picks the next candidate that can, same as the old per-candidate loop", () => {
    const scored = [
      { id: "needs-arg", score: 0.99 }, // scores highest, but can never bind
      { id: "no-arg", score: TIER1_THRESHOLD }, // clears the threshold on its own, once needs-arg is out of the way
    ];
    const winner = pickTier1WinnerAmong(scored, (id) => id === "no-arg");
    expect(winner).toEqual({ id: "no-arg", score: TIER1_THRESHOLD });
  });

  test("still returns null when nothing left can fire", () => {
    const scored = [
      { id: "needs-arg-1", score: 0.9 },
      { id: "needs-arg-2", score: 0.7 },
    ];
    expect(pickTier1WinnerAmong(scored, () => false)).toBeNull();
  });

  test("once the disqualified top pick is removed, the sole remaining candidate is re-checked on its own (no longer against a disqualified one)", () => {
    const scored = [
      { id: "needs-arg", score: 0.9 },
      { id: "runner-up", score: 0.9 - TIER1_MARGIN - 0.01 }, // clears its own margin against needs-arg, so needs-arg wins the first pass
    ];
    expect(pickTier1WinnerAmong(scored, (id) => id === "runner-up")?.id).toBe("runner-up");
  });

  test("a genuinely ambiguous pair never fires at all, disqualification or not", () => {
    const scored = [
      { id: "needs-arg", score: 0.9 },
      { id: "close-behind", score: 0.9 - TIER1_MARGIN + 0.01 }, // too close to needs-arg to win the FIRST pass outright
    ];
    // pickTier1Winner itself returns null on the very first call here
    // (the margin fails before canFire is ever consulted) - the
    // disqualification retry never even starts.
    expect(pickTier1WinnerAmong(scored, (id) => id === "close-behind")).toBeNull();
  });
});

describe("routing_embeddings composite key: a concurrent second embed of the identical new example never throws", () => {
  test("onConflictDoUpdate absorbs the race instead of a UNIQUE constraint error", async () => {
    // Two turns racing on a genuinely new example (nothing stored for
    // this hash yet): ensureRoutingEmbeddings' own exists-check can't
    // prevent this - both see "nothing yet" and both try to insert the
    // identical (package_id, example_hash, space) row.
    await Promise.all([
      ensureRoutingEmbeddings([{ id: "race-pkg", examples: ["a brand new example"] }]),
      ensureRoutingEmbeddings([{ id: "race-pkg", examples: ["a brand new example"] }]),
    ]);
    expect(rowsFor("race-pkg")).toHaveLength(1);
  });
});

describe("routing_embeddings: candidate ids never clash across different packages", () => {
  test("two packages, one shared example text, still keep separate rows (packageId is part of the key)", async () => {
    await ensureRoutingEmbeddings([
      { id: "pkg-a", examples: ["hello there"] },
      { id: "pkg-b", examples: ["hello there"] },
    ]);
    expect(rowsFor("pkg-a")).toHaveLength(1);
    expect(rowsFor("pkg-b")).toHaveLength(1);
  });
});
