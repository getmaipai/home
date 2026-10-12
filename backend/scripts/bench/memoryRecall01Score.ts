// MEMORY-RECALL-01 scorer and fixture loader: pure functions, no database, no
// engine, so a test can import it. Reuses judgeScore.ts (extraction tp/fp/miss)
// and routeStats.ts (paired family bootstrap); nothing here is copied from them.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreCase, type CaseScore } from "./judgeScore";
import { pairedFamilyBootstrap, type Interval, type RouteRow } from "./routeStats";
import { detectCredential } from "../../src/lib/memoryContentPolicy";

export const PERSONA_ROSTER = new Set(
  "alfred astro atlas bramble bruno clover cosmo daisy ember indigo iris juniper lucia marlow marsh mopey nadia nova oliver pippa quill raven riff rivet rover sage serena sprout tempo velvet vincent willow".split(" "),
);

export type JudgeKind = "fact" | "preference" | "state" | "update" | "possessive" | "reported" | "noise" | "curiosity";
export interface JudgeRow { id: string; speaker: string; kind: JudgeKind; user: string; reply: string; expected: string[][]; mustNotContain?: string[] }
export interface MemorySeed { key: string; subject: string | null; category: string; text: string; childDisclosure?: "child_ok" | "teen_ok" | "adult_only" }
export interface HouseholdFixture { people: { name: string; role: string }[]; pets: string[]; memories: MemorySeed[] }
export interface RecallRow { id: string; household: string; speaker: string; query: string; followUp?: { prior: string; resolvesTo: string }; expect: string[]; forbid: string[]; subject: string | null; abstain?: boolean }
export interface PolicyRow { id: string; kind: "credential" | "not_credential" | "child" | "teen"; speaker: string; text: string; householdMemory?: string }
export interface Fixture { version: number; item: string; households: Record<string, HouseholdFixture>; judge: JudgeRow[]; recall: RecallRow[]; policy: PolicyRow[] }

export type Split = "tuning" | "heldout";
/** About 60/40 by the hash of the row id; the same id always lands in the same half. */
export function splitOf(id: string): Split {
  const n = createHash("sha256").update(id).digest().readUInt32BE(0) % 100;
  return n < 60 ? "tuning" : "heldout";
}

export function loadFixture(file = join(import.meta.dir, "datasets", "memory-recall-01.json")): Fixture {
  return JSON.parse(readFileSync(file, "utf8")) as Fixture;
}

/** Problems with the fixture; empty means valid. */
export function validateFixture(f: Fixture): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const dup = (id: string) => { if (ids.has(id)) problems.push(`duplicate id ${id}`); ids.add(id); };
  const persona = (name: string, where: string) => { if (!PERSONA_ROSTER.has(name.toLowerCase())) problems.push(`${where}: "${name}" is not on the persona roster`); };
  const keys = new Map<string, string>();
  for (const [hid, h] of Object.entries(f.households)) {
    for (const p of h.people) persona(p.name, `household ${hid}`);
    for (const p of h.pets) persona(p, `household ${hid}`);
    for (const m of h.memories) {
      if (keys.has(m.key)) problems.push(`duplicate memory key ${m.key}`);
      keys.set(m.key, hid);
      if (m.subject) persona(m.subject, m.key);
    }
  }
  for (const r of f.judge) {
    dup(r.id); persona(r.speaker, r.id);
    if ((r.kind === "noise" || r.kind === "curiosity") !== (r.expected.length === 0)) problems.push(`${r.id}: ${r.kind} rows expect nothing, other kinds expect something`);
    if (r.expected.some((k) => k.length === 0)) problems.push(`${r.id}: empty keyword set`);
    if (r.kind === "possessive" && !(r.mustNotContain?.length)) problems.push(`${r.id}: possessive rows need mustNotContain`);
  }
  for (const r of f.recall) {
    dup(r.id);
    const h = f.households[r.household];
    if (!h) { problems.push(`${r.id}: unknown household ${r.household}`); continue; }
    persona(r.speaker, r.id);
    if (!h.people.some((p) => p.name === r.speaker)) problems.push(`${r.id}: speaker ${r.speaker} not in household ${r.household}`);
    for (const k of [...r.expect, ...r.forbid]) if (keys.get(k) !== r.household) problems.push(`${r.id}: memory ${k} is not in household ${r.household}`);
    if (r.abstain && r.expect.length) problems.push(`${r.id}: abstain rows expect nothing`);
    if (!r.abstain && !r.expect.length) problems.push(`${r.id}: needs an expected memory`);
    if (r.followUp) persona(r.followUp.resolvesTo, r.id);
  }
  for (const r of f.policy) {
    dup(r.id);
    if (r.kind === "child" || r.kind === "teen") {
      if (!r.householdMemory || !keys.has(r.householdMemory)) problems.push(`${r.id}: unknown householdMemory`);
    } else if (r.householdMemory) problems.push(`${r.id}: householdMemory only on child/teen rows`);
  }
  for (const r of [...f.judge.map((j) => j.user + " " + j.reply), ...f.policy.map((p) => p.text), ...f.recall.map((q) => q.query)]) {
    if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|@[A-Za-z0-9-]+\.[a-z]{2,}|\b\d{3}-\d{3,4}\b/.test(r)) problems.push(`address, email or phone shape in: ${r}`);
  }
  return problems;
}

export function countFixture(f: Fixture): Record<string, number> {
  const out: Record<string, number> = { judge: f.judge.length, recall: f.recall.length, policy: f.policy.length, memories: Object.values(f.households).reduce((n, h) => n + h.memories.length, 0) };
  for (const kind of new Set(f.judge.map((r) => r.kind))) out[`judge:${kind}`] = f.judge.filter((r) => r.kind === kind).length;
  out["recall:followUp"] = f.recall.filter((r) => r.followUp).length;
  out["recall:abstain"] = f.recall.filter((r) => r.abstain).length;
  for (const split of ["tuning", "heldout"] as const) out[`split:${split}`] = [...f.judge, ...f.recall, ...f.policy].filter((r) => splitOf(r.id) === split).length;
  return out;
}

// ---- judge ----

const GENERIC_USER_RE = /\b(?:the user|user's|users')\b/i;
export interface JudgeRowScore extends CaseScore {
  id: string; kind: JudgeKind;
  /** The extractions that named the speaker's referent generically or hit the row's mustNotContain list. */
  wrongPerson: string[];
}
export function scoreJudgeRow(row: JudgeRow, extracted: readonly string[]): JudgeRowScore {
  const base = scoreCase({ turnId: row.id, label: row.kind, expected: row.expected, extracted });
  const banned = (row.mustNotContain ?? []).map((s) => s.toLowerCase());
  const wrongPerson = extracted.filter((t) => GENERIC_USER_RE.test(t) || banned.some((b) => t.toLowerCase().includes(b)));
  return { ...base, id: row.id, kind: row.kind, wrongPerson };
}

export interface JudgeSummary { recall: number | null; falseSaves: number; falseSaveRows: number; noiseRows: number; attributionRows: number; wrongAttributionRows: number; attributionAccuracy: number | null }
export function summarizeJudge(scores: readonly JudgeRowScore[]): JudgeSummary {
  const tp = scores.reduce((n, s) => n + s.truePositives, 0);
  const miss = scores.reduce((n, s) => n + s.misses, 0);
  const noise = scores.filter((s) => s.kind === "noise" || s.kind === "curiosity");
  const attribution = scores.filter((s) => s.kind === "possessive");
  const wrong = attribution.filter((s) => s.wrongPerson.length > 0 || s.misses > 0);
  return {
    recall: tp + miss === 0 ? null : tp / (tp + miss),
    falseSaves: noise.reduce((n, s) => n + s.falsePositives, 0),
    falseSaveRows: noise.filter((s) => s.falsePositives > 0).length,
    noiseRows: noise.length,
    attributionRows: attribution.length,
    wrongAttributionRows: wrong.length,
    attributionAccuracy: attribution.length === 0 ? null : 1 - wrong.length / attribution.length,
  };
}

// ---- recall ----

export interface RecallRowScore { id: string; hit: boolean; leak: boolean; subjectOk: boolean; abstained: boolean | null; pass: boolean }
/** returnedKeys: fixture keys of the memories the turn surfaced, best first; subjectNames: the subjects those memories belong to. */
export function scoreRecallRow(row: RecallRow, returnedKeys: readonly string[], subjectNames: readonly string[], k = 5): RecallRowScore {
  const top = returnedKeys.slice(0, k);
  const hit = row.expect.every((key) => top.includes(key));
  const leak = row.forbid.some((key) => top.includes(key));
  const subjectOk = row.subject === null || row.abstain === true || subjectNames.includes(row.subject);
  const abstained = row.abstain ? top.length === 0 || !row.forbid.some((key) => top.includes(key)) : null;
  const pass = row.abstain ? !leak : hit && !leak && subjectOk;
  return { id: row.id, hit, leak, subjectOk, abstained, pass };
}

// ---- policy (deterministic, never through a learned path) ----

export interface PolicyScore { id: string; kind: PolicyRow["kind"]; pass: boolean }
/** Credential rows are scored offline by detectCredential; child and teen rows are scored live: surfaced = the audience-gated memory reached the recall result. */
export function scorePolicyRow(row: PolicyRow, live?: { surfaced: boolean; remembered?: boolean }): PolicyScore | null {
  if (row.kind === "credential") return { id: row.id, kind: row.kind, pass: detectCredential(row.text).detected && (live?.remembered !== true) };
  if (row.kind === "not_credential") return { id: row.id, kind: row.kind, pass: !detectCredential(row.text).detected };
  if (!live) return null;
  return { id: row.id, kind: row.kind, pass: !live.surfaced };
}

// ---- statistics: 3 repeats, paired 95% bootstrap against the same-session baseline ----

export interface ArmRow { id: string; rep: number; ok: boolean }
const toRoute = (rows: readonly ArmRow[]): RouteRow[] => rows.map((r) => ({ id: r.id, family: r.id, split: splitOf(r.id), rep: r.rep, evidence: r.ok }));
export function pairedDelta(baseline: readonly ArmRow[], candidate: readonly ArmRow[], iterations = 10_000): Interval {
  return pairedFamilyBootstrap(toRoute(baseline), toRoute(candidate), iterations);
}
export function passRate(rows: readonly ArmRow[]): number | null {
  return rows.length === 0 ? null : rows.filter((r) => r.ok).length / rows.length;
}
export function bySplit(rows: readonly ArmRow[], split: Split): ArmRow[] { return rows.filter((r) => splitOf(r.id) === split); }
