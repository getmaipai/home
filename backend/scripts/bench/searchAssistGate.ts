// ROUTER-BUILD-01f: offline gate arithmetic for the search assist head. Pure: frozen embedding
// vectors in, rates out. The gate test (tests/searchAssistGate.test.ts) and the production bench
// arm's weights seam share this file, so the shipped scorer (src/lib/searchAssist/score.ts) is the
// only scoring code either one runs (principle 1).
import { readFileSync } from "node:fs";
import { buildFeatures, scoreHead } from "@/lib/searchAssist/score";
import { parseSearchAssistManifest, type SearchAssistManifest } from "@/lib/searchAssist/weights";

export interface GateRow {
  /** A persona-safe label; the gate file holds vectors only, never an utterance. */
  id: string;
  category: "recency" | "stable" | "no_tool";
  followUp?: boolean;
  alone: number[];
  pair?: number[];
}

export interface GateRates {
  n: number;
  /** Share of recency rows the head sends to a search (RAW-01 "R"). */
  recall: number;
  /** Share of stable rows falsely searched (RAW-01 "FS"). */
  falseSearchStable: number;
  /** Share of no_tool rows falsely searched (RAW-01 "FN"). */
  falseSearchNoTool: number;
  /** No_tool follow-up rows falsely searched, out of the follow-ups present. */
  falseSearchFollowUp: number;
}

const share = (hits: number, of: number): number => (of === 0 ? 0 : hits / of);

export function gateRates(rows: readonly GateRow[], manifest: SearchAssistManifest, tool = "websearch"): GateRates {
  const over = (row: GateRow): boolean => {
    const features = buildFeatures({ alone: row.alone, ...(row.pair ? { pair: row.pair } : {}) }, manifest);
    if (!features) throw new Error(`gate row ${row.id} does not fit the manifest (dims ${manifest.embed.dims}); rebuild the frozen vectors`);
    return scoreHead(features, manifest, tool).over;
  };
  const by = (category: GateRow["category"]) => rows.filter((r) => r.category === category);
  const recency = by("recency");
  const noTool = by("no_tool");
  const followUps = noTool.filter((r) => r.followUp);
  return {
    n: rows.length,
    recall: share(recency.filter(over).length, recency.length),
    falseSearchStable: share(by("stable").filter(over).length, by("stable").length),
    falseSearchNoTool: share(noTool.filter(over).length, noTool.length),
    falseSearchFollowUp: share(followUps.filter(over).length, followUps.length),
  };
}

export interface GateFloors {
  /** Recall must be at least this. */
  recallMin: number;
  /** False-search rates must be at most these. */
  falseSearchStableMax: number;
  falseSearchNoToolMax: number;
  falseSearchFollowUpMax: number;
}

/** Empty when the rates clear the floors, otherwise one plain line per miss. `tolerance` widens each
 * floor by that many points (as a share, 0.02 is two points) so one row of noise on a small set does not fail the gate. */
export function floorMisses(rates: GateRates, floors: GateFloors, tolerance: number): string[] {
  const misses: string[] = [];
  if (rates.recall + tolerance < floors.recallMin) misses.push(`recall ${rates.recall.toFixed(3)} is below ${floors.recallMin} (tolerance ${tolerance})`);
  if (rates.falseSearchStable - tolerance > floors.falseSearchStableMax) misses.push(`stable false searches ${rates.falseSearchStable.toFixed(3)} are above ${floors.falseSearchStableMax}`);
  if (rates.falseSearchNoTool - tolerance > floors.falseSearchNoToolMax) misses.push(`no_tool false searches ${rates.falseSearchNoTool.toFixed(3)} are above ${floors.falseSearchNoToolMax}`);
  if (rates.falseSearchFollowUp - tolerance > floors.falseSearchFollowUpMax) misses.push(`follow-up false searches ${rates.falseSearchFollowUp.toFixed(3)} are above ${floors.falseSearchFollowUpMax}`);
  return misses;
}

/** Bench-only: a trained manifest read from a local file, for the production arm before the signed
 * release exists. It runs through the same parser the loader uses; it is never reached by the app. */
export function readBenchManifest(path: string): SearchAssistManifest {
  return parseSearchAssistManifest(JSON.parse(readFileSync(path, "utf8")));
}
