// Session C step 1 (session-c-brain-and-voice.md): runs
// spec/llm/routing-corpus.json against the real bundled packages and
// skills through the stub embedder - the deterministic-suite half of
// this step's own required test ("A test runs the corpus against the
// stub embedder with fixed vectors"; the real-embedder half is
// backend/scripts/bench/routing.ts, run on demand, never part of this
// suite). `expect: null` covers both "nothing should route" and "a
// SKILL should compose, not a plugin fire" - `route()` only ever
// returns a plugin, so a corpus row whose `expect` names a skill id
// (storytime-style) is checked against `matchingSkills()`'s own top
// pick instead.
import { describe, test, expect, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { route, matchingSkills, loadAllManifests } from "@/lib/turnEngine";
import { loadAllSkills } from "@/lib/skills";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
});

interface CorpusRow {
  utterance: string;
  expect: string | null;
  args?: Record<string, unknown>;
  must_not: string[];
  note?: string;
}

const corpus: CorpusRow[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "spec", "llm", "routing-corpus.json"), "utf-8"));

function fakeActor(): PersonRow {
  return {
    id: "person-corpus",
    displayName: "Corpus",
    nickname: null,
    birthdate: null,
    role: "adult",
    avatarSeed: "seed",
    source: "hub",
    localOnly: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    enabled: true,
    guestExpiresAt: null,
    memorializedAt: null,
    hlc: "1700000000000:0:testfix",
  };
}

/** The one combined "what did this utterance actually route to" answer,
 * across both mechanisms a real turn checks (route()'s plugin floor,
 * matchingSkills()'s skill relevance) - mirrors prepareTurn()'s own
 * shape without the safety/command/model machinery a routing-only test
 * has no need to exercise. */
async function resolve(utterance: string, actor: PersonRow): Promise<{ routedId: string | null; args?: Record<string, unknown>; candidates: string[] }> {
  const loaded = loadAllManifests();
  const skills = loadAllSkills();
  const { winner: routed } = await route(utterance, actor, loaded);
  const skillMatches = matchingSkills(utterance, skills);
  const candidates = [...(routed ? [routed.id] : []), ...skillMatches.map((m) => m.skill.manifest.id)];
  if (routed) return { routedId: routed.id, args: routed.args, candidates };
  if (skillMatches[0]) return { routedId: skillMatches[0].skill.manifest.id, candidates };
  return { routedId: null, candidates };
}

describe("routing corpus (stub embedder, deterministic suite)", () => {
  const actor = fakeActor();

  for (const row of corpus) {
    test(row.utterance, async () => {
      const { routedId, args, candidates } = await resolve(row.utterance, actor);
      expect(routedId).toBe(row.expect);
      if (row.args) expect(args).toMatchObject(row.args);
      for (const forbidden of row.must_not) {
        expect(candidates).not.toContain(forbidden);
      }
    });
  }
});
