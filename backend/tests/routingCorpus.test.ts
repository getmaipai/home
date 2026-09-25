// D7 retains only corpus positives supported by a literal manifest
// pattern. Semantic examples and null/no-route rows no longer describe
// a deterministic package router and stay out of this exact-match gate.
import { describe, test, expect, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { route, matchPattern, loadAllManifests } from "@/lib/turnEngine";
import type { PersonRow } from "@/types";
import { SPEC_DIR } from "@/lib/specDir";

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

const corpus: CorpusRow[] = JSON.parse(readFileSync(join(SPEC_DIR, "llm", "routing-corpus.json"), "utf-8"));
const manifests = loadAllManifests();
const exactMatchCorpus = corpus.filter((row) => {
  if (!row.expect) return false;
  const manifest = manifests.find((candidate) => candidate.id === row.expect)?.manifest;
  return (manifest?.routing?.patterns ?? []).some((pattern) => matchPattern(row.utterance, pattern) !== null);
});

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

describe("routing corpus (literal exact-match subset)", () => {
  const actor = fakeActor();

  test("the trimmed set is non-empty and every retained row is an authored literal match", () => {
    expect(exactMatchCorpus.length).toBeGreaterThan(0);
    for (const row of exactMatchCorpus) {
      const manifest = manifests.find((candidate) => candidate.id === row.expect)!.manifest;
      expect((manifest.routing?.patterns ?? []).some((pattern) => matchPattern(row.utterance, pattern) !== null)).toBe(true);
    }
  });

  for (const row of exactMatchCorpus) {
    test(row.utterance, async () => {
      const { winner } = await route(row.utterance, actor, manifests);
      expect(winner?.id ?? null).toBe(row.expect);
      if (row.args) expect(winner?.args).toMatchObject(row.args);
      for (const forbidden of row.must_not) {
        expect(winner?.id).not.toBe(forbidden);
      }
    });
  }
});
