// ACT-02: pools the four license-clean act/stance label sources
// (Taskmaster-1, CCPE-M, the bench fixture's un-hinted turns, the
// synthetic roster dialogues) into one deduplicated, seed-shuffled,
// size-capped list of labeling candidates. DailyDialog is never in this
// pool - CC BY-NC-SA, validation-only (docs/dev.md section 12).
import { readFileSync } from "node:fs";
import { loadTaskmaster1 } from "../bench/datasets/taskmaster1";
import { loadCcpeM } from "../bench/datasets/ccpeM";
import { absolutePath } from "../bench/datasets/registry";
import { seededShuffle } from "../bench/datasets/sample";
import { splitFixture } from "./fixtureSignals";
import { SYNTHETIC_ROSTER_DIALOGUES } from "./syntheticRosterDialogues";
import type { LabelCandidate } from "./labelActStance";

const CORPUS_SEED = 20260914;

function taskmaster1UserTurns(variant: "self" | "woz"): LabelCandidate[] {
  const file = variant === "self" ? "taskmaster1/self-dialogs.json" : "taskmaster1/woz-dialogs.json";
  const raw = JSON.parse(readFileSync(absolutePath(file), "utf-8")) as unknown[];
  const { conversations } = loadTaskmaster1(raw, variant);
  const out: LabelCandidate[] = [];
  for (const conv of conversations) {
    for (const turn of conv.sessions[0]!.turns) {
      if (turn.speaker !== "USER") continue;
      const text = turn.text.trim();
      if (text.length < 2) continue;
      out.push({ id: `taskmaster1-${variant}:${turn.turnId}`, text });
    }
  }
  return out;
}

function ccpeMUserTurns(): LabelCandidate[] {
  const raw = JSON.parse(readFileSync(absolutePath("ccpe/data.json"), "utf-8")) as unknown[];
  const { conversations } = loadCcpeM(raw);
  const out: LabelCandidate[] = [];
  for (const conv of conversations) {
    for (const turn of conv.sessions[0]!.turns) {
      if (turn.speaker !== "USER") continue;
      const text = turn.text.trim();
      if (text.length < 2) continue;
      out.push({ id: `ccpe-m:${turn.turnId}`, text });
    }
  }
  return out;
}

export interface CorpusStats {
  taskmaster1Self: number;
  taskmaster1Woz: number;
  ccpeM: number;
  fixture: number;
  synthetic: number;
  pooledBeforeCap: number;
  afterCap: number;
}

/** Dedupes by lowercased text, keeps every `synthetic:`/`fixture:`
 * candidate outright (small, deliberately shaped for classes the public
 * corpora are thin on), and seed-shuffles the rest down to `targetSize`
 * total - the pure pooling logic, with no file IO, so it is unit-
 * testable without the real datasets on disk. Fixture and synthetic are
 * pooled FIRST so they claim the canonical slot for their own text: a
 * code review (2026-09-14) caught the guaranteed sources going last,
 * which meant a generic synthetic backchannel ("ok", "wow") got silently
 * dropped by the dedupe whenever the much larger Taskmaster-1/CCPE-M
 * pool happened to contain the identical string first - defeating the
 * guarantee for exactly the thin classes it exists to protect. */
export function poolAndCapCandidates(sources: { taskmaster1Self: readonly LabelCandidate[]; taskmaster1Woz: readonly LabelCandidate[]; ccpeM: readonly LabelCandidate[]; fixture: readonly LabelCandidate[]; synthetic: readonly LabelCandidate[] }, targetSize: number): { candidates: LabelCandidate[]; stats: CorpusStats } {
  const pooled = [...sources.fixture, ...sources.synthetic, ...sources.taskmaster1Self, ...sources.taskmaster1Woz, ...sources.ccpeM];
  const seenText = new Set<string>();
  const deduped = pooled.filter((c) => {
    const key = c.text.toLowerCase();
    if (seenText.has(key)) return false;
    seenText.add(key);
    return true;
  });

  const guaranteed = deduped.filter((c) => c.id.startsWith("synthetic:") || c.id.startsWith("fixture:"));
  const rest = seededShuffle(
    deduped.filter((c) => !c.id.startsWith("synthetic:") && !c.id.startsWith("fixture:")),
    CORPUS_SEED,
  );
  const remainingBudget = Math.max(0, targetSize - guaranteed.length);
  const candidates = [...guaranteed, ...rest.slice(0, remainingBudget)];

  return {
    candidates,
    stats: {
      taskmaster1Self: sources.taskmaster1Self.length,
      taskmaster1Woz: sources.taskmaster1Woz.length,
      ccpeM: sources.ccpeM.length,
      fixture: sources.fixture.length,
      synthetic: sources.synthetic.length,
      pooledBeforeCap: deduped.length,
      afterCap: candidates.length,
    },
  };
}

export function buildActStanceCorpus(targetSize: number): { candidates: LabelCandidate[]; stats: CorpusStats } {
  const tmSelf = taskmaster1UserTurns("self");
  const tmWoz = taskmaster1UserTurns("woz");
  const ccpe = ccpeMUserTurns();
  const { trainingCandidates: fixtureCandidates } = splitFixture();
  const synthetic: LabelCandidate[] = SYNTHETIC_ROSTER_DIALOGUES.map((text, i) => ({ id: `synthetic:${i}`, text }));
  return poolAndCapCandidates({ taskmaster1Self: tmSelf, taskmaster1Woz: tmWoz, ccpeM: ccpe, fixture: fixtureCandidates, synthetic }, targetSize);
}
