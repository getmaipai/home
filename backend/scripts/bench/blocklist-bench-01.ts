// MINOR-SEARCH-01e-7: blocked-site list bench (design section 7, rule 13). Reads a labelled dataset and one or more
// pinned list files, scores each list arm on the held-out split, prints the pass bars and the two decisions.
//
//   bun scripts/bench/blocklist-bench-01.ts --dataset <dataset.json> \
//     --pin blp-porn=<list file> --pin blp-drugs=<list file> ... [--pin-format blp-porn=hosts] \
//     [--stevenblack <hosts file>] [--out <report.json>] [--allow-short] [--microbench]
//
// A `--pin label=path` is a list file (not run, only read as text). Repeat the same label with different files for
// several pins; the scorer averages per host (rule 13: 3 or more repeats). Nothing is fetched or written outside --out.
import { readFileSync, writeFileSync } from "node:fs";
import { parseHostList, type HostListFormat } from "@maipai/spec/interpreters/ts/hostList.js";
import {
  drugsTeenDecision, makeMatcher, meanHits, pairedOver, passBars, rowsDroppedPerSearch, scoreArm, splitOf,
  strictAloneRecall, unionDecision, unionMatcher, validateDataset, type ArmScore, type BenchDataset,
} from "./blocklistBenchScore";

function args(argv: string[]): { flags: Map<string, string[]>; bools: Set<string> } {
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { bools.add(a.slice(2)); continue; }
    flags.set(a.slice(2), [...(flags.get(a.slice(2)) ?? []), next]);
    i++;
  }
  return { flags, bools };
}

function fail(message: string): never { console.error(message); process.exit(2); }

const { flags, bools } = args(process.argv.slice(2));
const datasetPath = flags.get("dataset")?.[0] ?? fail("Pass --dataset <file>. It is the labelled JSON kept in data-scratch.");
const raw: unknown = JSON.parse(readFileSync(datasetPath, "utf8"));
const check = validateDataset(raw, { allowShort: bools.has("allow-short") });
for (const w of check.warnings) console.warn(`warning: ${w}`);
if (check.errors.length) fail(`The dataset is not ready:\n- ${check.errors.slice(0, 20).join("\n- ")}\nFix these and run again.`);
const data = raw as BenchDataset;

const pinArgs = flags.get("pin") ?? fail("Pass at least one --pin label=file, for example --pin blp-porn=/path/porn.txt.");
const formats = new Map<string, string>();
for (const s of flags.get("pin-format") ?? []) {
  const [label, fmt] = s.split("=");
  if (!label || (fmt !== "hosts" && fmt !== "domains")) fail(`--pin-format "${s}" must look like label=hosts or label=domains.`);
  formats.set(label, fmt);
}
const pins = new Map<string, Set<string>[]>();
for (const spec of pinArgs) {
  const eq = spec.indexOf("=");
  if (eq < 1) fail(`--pin "${spec}" must look like label=file.`);
  const label = spec.slice(0, eq);
  const format = (formats.get(label) ?? "hosts") as HostListFormat;
  const parsed = parseHostList(readFileSync(spec.slice(eq + 1), "utf8"), format);
  pins.set(label, [...(pins.get(label) ?? []), new Set(parsed.hosts)]);
}
const stevenblack = flags.get("stevenblack")?.[0];
const sbSet = stevenblack ? new Set(parseHostList(readFileSync(stevenblack, "utf8"), "hosts" as HostListFormat).hosts) : null;

const everyHost = [...data.positives.map((p) => p.host), ...data.negatives.map((n) => n.host)];
function hitMap(matchers: ReadonlyArray<(h: string) => boolean>): Map<string, number> {
  return meanHits(matchers.map((m) => new Map(everyHost.map((h) => [h, m(h) ? 1 : 0] as [string, number]))));
}
const arms = new Map<string, Map<string, number>>();
for (const [label, sets] of pins) arms.set(label, hitMap(sets.map((s) => makeMatcher(s, "suffix"))));
if (pins.has("blp-porn")) arms.set("blp-porn exact", hitMap((pins.get("blp-porn") ?? []).map((s) => makeMatcher(s, "exact"))));
if (sbSet && pins.has("blp-porn")) {
  arms.set("union blp-porn + StevenBlack", hitMap(pins.get("blp-porn")!.map((s) => unionMatcher([makeMatcher(s, "suffix"), makeMatcher(sbSet, "suffix")]))));
}

const held = new Map<string, ArmScore>();
const dev = new Map<string, ArmScore>();
for (const [label, hit] of arms) { held.set(label, scoreArm(label, "heldout", data, hit)); dev.set(label, scoreArm(label, "dev", data, hit)); }

const strict = strictAloneRecall(data, "heldout");
const defaultOn = ["blp-porn"];
const bars = passBars(held, strict, defaultOn);
const heldPos = data.positives.filter((p) => splitOf(p.host) === "heldout").map((p) => p.host);
const unionArm = arms.get("union blp-porn + StevenBlack");
const gain = unionArm && arms.get("blp-porn") ? pairedOver(heldPos, unionArm, arms.get("blp-porn")!) : null;
const decisions = [drugsTeenDecision(held.get("blp-drugs")), unionDecision(gain, held.get("union blp-porn + StevenBlack"))];
const rows = Object.fromEntries([...arms].map(([label, hit]) => {
  const blocked = (h: string) => (hit.get(h) ?? 0) >= 0.5;
  return [label, rowsDroppedPerSearch(data.queries ?? [], blocked)];
}));

let micro: { lookups: number; usPerLookup: number } | undefined;
if (bools.has("microbench")) {
  const set = pins.get("blp-porn")?.[0] ?? fail("--microbench needs a blp-porn pin.");
  const m = makeMatcher(set, "suffix");
  const probe = everyHost.length ? everyHost : ["example.com"];
  const start = performance.now();
  const loops = 200;
  for (let i = 0; i < loops; i++) for (const h of probe) m(h);
  micro = { lookups: loops * probe.length, usPerLookup: Math.round((1000 * (performance.now() - start)) / (loops * probe.length)) / 1000 };
}

const report = {
  dataset: { positives: check.positives, negatives: check.negatives },
  pinsPerList: Object.fromEntries([...pins].map(([k, v]) => [k, v.length])),
  repeatsOk: [...pins.values()].every((v) => v.length >= 3),
  heldout: Object.fromEntries(held), dev: Object.fromEntries(dev),
  strictAlone: strict, bars, decisions, rowsDropped: rows, microbench: micro,
};
console.log(JSON.stringify(report, null, 2));
if (!report.repeatsOk) console.warn("warning: rule 13 needs 3 or more pins per list; this run has fewer, so it cannot decide anything.");
const out = flags.get("out")?.[0];
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
process.exit(bars.some((b) => b.pass === false) ? 1 : 0);
