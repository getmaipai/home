/**
 * Pin stability bench: how often the research pin picks the same article for the same question.
 *
 *   bun run scripts/bench/pinStability.ts "<utterance>" [--n 10] [--fixture <file.json>] [--stack http://127.0.0.1:8770]
 *
 * Part 1 runs `understand(utterance)` N times (default 10) and prints the distribution of subjects and titles the brief writer produced.
 * Part 2 runs `pinEntity` N times with `__setEntityPinForTests({ finder })` serving stored candidate fixtures (the fixture file maps a search
 * query to [{ title, snippet }]; without one, each brief title returns itself), using the real pick writer against the real Stack
 * (default http://127.0.0.1:8770), paced and one at a time, and prints the pick / settled / also distribution.
 * It talks to the live Stack: keep N small and do not run it while the household is chatting. Run with a fresh data dir, like the other benches:
 *   MAIPAI_DATA_DIR=<fresh dir under the OS temp root> bun run scripts/bench/pinStability.ts "<utterance>"
 */
import { readFileSync } from "node:fs";
import type { EntityCandidate } from "@/lib/turnMachine/entityPin";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1]! : fallback; };
const utterance = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--"))) ?? "";
const n = Math.max(1, Number(flag("n", "10")) || 10);
const stack = flag("stack", "http://127.0.0.1:8770");
const fixturePath = flag("fixture", "");
const PACE_MS = 1_500;

if (!utterance) { console.error('usage: bun run scripts/bench/pinStability.ts "<utterance>" [--n 10] [--fixture file.json] [--stack url]'); process.exit(2); }

const setup = await import("./setup");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { __setEntityPinForTests, pinEntity } = await import("@/lib/turnMachine/entityPin");
const { understand } = await import("@/lib/turnMachine/researchPipeline");
const { createBenchPeople } = await import("./conversationRunner");
await setup.startBench();
const set = setHouseholdSettingValue("engines.stack.url", stack);
if (!set.ok) throw new Error(`stack setting: ${set.error}`);
const person = createBenchPeople().owner;

const tally = (counts: Map<string, number>): void => { for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`); };
const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const fixtures: Record<string, { title: string; snippet: string }[]> = fixturePath ? JSON.parse(readFileSync(fixturePath, "utf8")) : {};
const asCandidate = (c: { title: string; snippet: string }): EntityCandidate => ({ title: c.title, snippet: c.snippet, load: async () => ({ title: c.title, lead: c.snippet, sections: [], source: "library" }) });

const briefs = [];
const subjects = new Map<string, number>();
const titleSets = new Map<string, number>();
for (let i = 0; i < n; i++) {
  const brief = await understand(utterance, "");
  if (brief) { briefs.push(brief); bump(subjects, brief.subject); bump(titleSets, JSON.stringify(brief.titles ?? [])); }
  await pause(PACE_MS);
}
console.log(`understand x${n}: ${briefs.length} briefs\nsubjects:`); tally(subjects); console.log("titles:"); tally(titleSets);

__setEntityPinForTests({
  finder: async (query) => (fixtures[query] ?? (Object.keys(fixtures).length === 0 ? [{ title: query, snippet: "" }] : [])).map(asCandidate),
});
const picks = new Map<string, number>();
for (let i = 0; i < n; i++) {
  const brief = briefs[i % Math.max(1, briefs.length)] ?? { subject: utterance, answerType: "", mustContain: [], ambiguous: false, options: [], question: "", assumption: "" };
  const { anchor } = await pinEntity(brief, utterance, person);
  bump(picks, anchor ? `${anchor.title} | settled=${anchor.unsettled ? "false" : "true"} | also=${anchor.unsettled?.title ?? "-"}` : "(none)");
  await pause(PACE_MS);
}
console.log(`pinEntity x${n}:`); tally(picks);
__setEntityPinForTests(undefined);
