// MINOR-SEARCH-01e-7 (design section 7, rule 13): scorer for the blocked-site list bench. Pure functions, no
// database and no network, so a test can import it. A bench-only file: nothing here takes part in a live turn.
//
// Dataset (a JSON file kept in data-scratch, never committed: it holds adult host names a person labelled):
//   { "version": 1,
//     "positives": [{ "host": "...", "title": "...", "strict_surfaced": false }],   // adult hosts, SafeSearch off
//     "negatives": [{ "host": "...", "topic": "health" }],                           // fresh minor queries
//     "queries":   [{ "query": "...", "hosts": ["..."] }] }                          // optional, rows-dropped replay
// `strict_surfaced` is true when the same host also came back with SafeSearch strict, so SafeSearch-strict alone
// would have let it through. The dev and held-out split is computed from the host name (`splitOf`), never stored,
// so it cannot be changed after a result is seen. Suffix depth and canary additions are tuned on dev only; every
// number that decides something is read on held-out.
import { createHash } from "node:crypto";
import { normalizeHost, probeNames } from "@/lib/blocklists/hostLists";
import { pairedInterval, type PairedInterval } from "./searchRecency02Score";
import { wilson, type Wilson } from "./minorSearchScore";

export type Split = "dev" | "heldout";
export type MatchMode = "exact" | "suffix";

export interface PositiveRow { host: string; title?: string; strict_surfaced: boolean }
export interface NegativeRow { host: string; topic?: string }
export interface QueryRow { query: string; hosts: string[] }
export interface BenchDataset { version: 1; positives: PositiveRow[]; negatives: NegativeRow[]; queries?: QueryRow[] }

/** Pre-registered sample sizes (design section 7). */
export const POSITIVES_REQUIRED = 400;
export const NEGATIVES_REQUIRED = 1500;
/** Share of hosts that go to dev. Fixed here, before any run. */
const DEV_SHARE_BYTE = 102; // first byte of the hash below 102 of 256: about 40% dev, 60% held-out

/** The split a host always lands in, from a hash of its normalised name. */
export function splitOf(host: string): Split {
  const first = createHash("sha256").update(`blocklist-bench-01:${host}`).digest()[0]!;
  return first < DEV_SHARE_BYTE ? "dev" : "heldout";
}

export interface DatasetCheck { errors: string[]; warnings: string[]; positives: number; negatives: number }

/** Errors stop the run; short samples are errors unless `allowShort` (a dry run on a small file). */
export function validateDataset(data: unknown, opts: { allowShort?: boolean } = {}): DatasetCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const d = data as Partial<BenchDataset> | null;
  if (!d || d.version !== 1 || !Array.isArray(d.positives) || !Array.isArray(d.negatives)) {
    return { errors: ["The dataset must be an object with version 1, a positives array and a negatives array."], warnings, positives: 0, negatives: 0 };
  }
  const seen = new Map<string, string>();
  const take = (kind: string, raw: unknown): string | null => {
    const host = typeof raw === "string" ? normalizeHost(raw) : null;
    if (!host || !host.includes(".")) { errors.push(`${kind}: "${String(raw).slice(0, 60)}" is not a host name. Write names like example.com.`); return null; }
    if (host !== raw) errors.push(`${kind}: "${String(raw)}" is not written in its normal form. Write "${host}".`);
    const prior = seen.get(host);
    if (prior) { errors.push(`${kind}: "${host}" is already in ${prior}. A host is labelled once.`); return null; }
    seen.set(host, kind);
    return host;
  };
  for (const row of d.positives) {
    take("positives", row?.host);
    if (typeof row?.strict_surfaced !== "boolean") errors.push(`positives: "${String(row?.host)}" needs strict_surfaced set to true or false.`);
  }
  for (const row of d.negatives) take("negatives", row?.host);
  if (d.positives.length < POSITIVES_REQUIRED) (opts.allowShort ? warnings : errors).push(`${d.positives.length} positives, ${POSITIVES_REQUIRED} are required.`);
  if (d.negatives.length < NEGATIVES_REQUIRED) (opts.allowShort ? warnings : errors).push(`${d.negatives.length} negatives, ${NEGATIVES_REQUIRED} are required.`);
  return { errors, warnings, positives: d.positives.length, negatives: d.negatives.length };
}

/** A matcher over a set of listed hosts. `suffix` walks the host up to its registrable domain (what the hub does);
 * `exact` asks about the full host name only. */
export function makeMatcher(listed: ReadonlySet<string>, mode: MatchMode): (host: string) => boolean {
  return (input) => {
    const host = normalizeHost(input);
    if (!host) return false;
    if (mode === "exact") return listed.has(host);
    for (const name of probeNames(host)) if (listed.has(name)) return true;
    return false;
  };
}

/** The union of several matchers: a host is blocked when any of them blocks it. */
export function unionMatcher(matchers: ReadonlyArray<(host: string) => boolean>): (host: string) => boolean {
  return (host) => matchers.some((m) => m(host));
}

export interface Rate { n: number; hits: number; ci: Wilson | null }

function rateOf(hosts: readonly string[], hit: ReadonlyMap<string, number>): Rate {
  let hits = 0;
  for (const h of hosts) if ((hit.get(h) ?? 0) >= 0.5) hits++; // pin-averaged: blocked when most pins block it
  return { n: hosts.length, hits, ci: wilson(hits, hosts.length) };
}

export interface ArmScore {
  arm: string;
  split: Split;
  recall: Rate;
  falsePositive: Rate;
  /** False-positive rate on the negatives whose topic is health or harm reduction (the drugs-for-teens question). */
  healthFalsePositive: Rate;
  /** Positives SafeSearch strict would have let through that this arm blocks. */
  rescued: Rate;
}

export const HEALTH_TOPICS = new Set(["health", "harm-reduction", "puberty", "mental-health"]);

/** One arm on one split. `hit` maps every dataset host to 1 (blocked) or 0. */
export function scoreArm(arm: string, split: Split, data: BenchDataset, hit: ReadonlyMap<string, number>): ArmScore {
  const pos = data.positives.filter((p) => splitOf(p.host) === split);
  const neg = data.negatives.filter((n) => splitOf(n.host) === split);
  const surfaced = pos.filter((p) => p.strict_surfaced).map((p) => p.host);
  return {
    arm,
    split,
    recall: rateOf(pos.map((p) => p.host), hit),
    falsePositive: rateOf(neg.map((n) => n.host), hit),
    healthFalsePositive: rateOf(neg.filter((n) => n.topic !== undefined && HEALTH_TOPICS.has(n.topic)).map((n) => n.host), hit),
    rescued: rateOf(surfaced, hit),
  };
}

/** SafeSearch strict alone: it blocks a positive that did not surface under strict. Same shape as a list arm. */
export function strictAloneRecall(data: BenchDataset, split: Split): Rate {
  const pos = data.positives.filter((p) => splitOf(p.host) === split);
  const hits = pos.filter((p) => !p.strict_surfaced).length;
  return { n: pos.length, hits, ci: wilson(hits, pos.length) };
}

/** Paired 95% interval, arm minus baseline, over per-host hit values (several pins averaged per host). */
export function pairedOver(hosts: readonly string[], arm: ReadonlyMap<string, number>, base: ReadonlyMap<string, number>): PairedInterval | null {
  const pick = (m: ReadonlyMap<string, number>): Map<string, number> => new Map(hosts.map((h) => [h, m.get(h) ?? 0]));
  return pairedInterval(pick(arm), pick(base));
}

/** The mean of per-pin hit maps: a host's value is the share of pins that blocked it. */
export function meanHits(perPin: ReadonlyArray<ReadonlyMap<string, number>>): Map<string, number> {
  const out = new Map<string, number>();
  if (perPin.length === 0) return out;
  for (const host of perPin[0]!.keys()) out.set(host, perPin.reduce((s, m) => s + (m.get(host) ?? 0), 0) / perPin.length);
  return out;
}

/** Mean rows dropped per search when an arm is on: how many hosts in a recorded result set the matcher removes. */
export function rowsDroppedPerSearch(queries: readonly QueryRow[], blocked: (host: string) => boolean): { searches: number; meanDropped: number; searchesWithDrop: number } {
  if (queries.length === 0) return { searches: 0, meanDropped: 0, searchesWithDrop: 0 };
  let total = 0;
  let withDrop = 0;
  for (const q of queries) {
    const dropped = q.hosts.filter(blocked).length;
    total += dropped;
    if (dropped > 0) withDrop++;
  }
  return { searches: queries.length, meanDropped: Math.round((100 * total) / queries.length) / 100, searchesWithDrop: withDrop };
}

export interface BarResult { name: string; pass: boolean | null; detail: string }

/** The pre-registered pass bars, read on held-out only. `pass: null` means the evidence is missing. */
export function passBars(scores: ReadonlyMap<string, ArmScore>, strict: Rate, defaultOn: readonly string[]): BarResult[] {
  const out: BarResult[] = [];
  const porn = scores.get("blp-porn");
  if (!porn?.recall.ci || !strict.ci || strict.n === 0) {
    out.push({ name: "blp-porn recall lower bound above SafeSearch strict alone", pass: null, detail: "no held-out positives scored" });
  } else {
    const strictPoint = Math.round((1000 * strict.hits) / strict.n) / 10;
    out.push({
      name: "blp-porn recall lower bound above SafeSearch strict alone",
      pass: porn.recall.ci.lowPct > strictPoint,
      detail: `blp-porn recall ${porn.recall.ci.lowPct}% to ${porn.recall.ci.highPct}%; strict alone ${strictPoint}% (interval ${strict.ci.lowPct}% to ${strict.ci.highPct}%)`,
    });
  }
  for (const id of defaultOn) {
    const s = scores.get(id);
    if (!s?.falsePositive.ci) { out.push({ name: `${id} false-positive upper bound under 1%`, pass: null, detail: "no held-out negatives scored" }); continue; }
    out.push({ name: `${id} false-positive upper bound under 1%`, pass: s.falsePositive.ci.highPct < 1, detail: `${s.falsePositive.hits} of ${s.falsePositive.n}, upper bound ${s.falsePositive.ci.highPct}%` });
  }
  return out;
}

export interface Decision { name: string; recommendation: string; detail: string }

/** blp-drugs for teens: on only when its false-positive upper bound on health and harm-reduction hosts is under 1%. */
export function drugsTeenDecision(drugs: ArmScore | undefined): Decision {
  const ci = drugs?.healthFalsePositive.ci;
  if (!drugs || !ci || drugs.healthFalsePositive.n === 0) return { name: "blp-drugs for teens", recommendation: "stay off", detail: "no health or harm-reduction negatives were scored, so there is no evidence to turn it on" };
  const ok = ci.highPct < 1;
  return { name: "blp-drugs for teens", recommendation: ok ? "turn on" : "stay off", detail: `${drugs.healthFalsePositive.hits} of ${drugs.healthFalsePositive.n} health hosts blocked, upper bound ${ci.highPct}%` };
}

/** The StevenBlack union: adopted only when it adds recall (paired lower bound above zero) and keeps the false-positive bar. */
export function unionDecision(recallGain: PairedInterval | null, union: ArmScore | undefined): Decision {
  if (!recallGain || !union?.falsePositive.ci) return { name: "StevenBlack porn union", recommendation: "keep blp-porn alone", detail: "not enough scored hosts to compare" };
  const gains = recallGain.lowPct > 0;
  const fpOk = union.falsePositive.ci.highPct < 1;
  return {
    name: "StevenBlack porn union",
    recommendation: gains && fpOk ? "adopt the union" : "keep blp-porn alone",
    detail: `recall gain ${recallGain.meanDiffPct} points (${recallGain.lowPct} to ${recallGain.highPct}); union false-positive upper bound ${union.falsePositive.ci.highPct}%`,
  };
}
