// ACT-02: DailyDialog's test split as the act and emotion heads' real,
// human-labeled validation set (never trained on - CC BY-NC-SA, per
// docs/dev.md section 12). Uses the real loader
// (../bench/datasets/dailydialog.ts, EVAL-07's own registry-based
// reader) rather than re-parsing the zip by hand.
//
// Act relabeling: DailyDialog's own scheme folds greeting, closing and
// backchannel into "inform" (Li et al. 2017 has no fifth-through-
// seventh act). docs/dev.md section 12: "DailyDialog's greeting and
// closing turns (labeled inform there) are relabeled by the rule pass
// before scoring so the comparison is fair" - classifyTurnSignal()
// (backend/src/lib/turnSignal.ts, read-only import: nothing under
// backend/src/ is this lane's to edit) already implements exactly that
// rule pass, so relabeling here means running the real production rules
// over each turn's own text and trusting them for the three management
// acts DailyDialog cannot express, never re-deriving a parallel guess.
import { loadDailyDialogSplit } from "../bench/datasets/dailydialog";
import { absolutePath } from "../bench/datasets/registry";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { DAILYDIALOG_ACT_ORDER, DAILYDIALOG_EMOTION_ORDER, type ActLabel, type EmotionLabel } from "./labelSets";

export interface DailyDialogExample {
  turnId: string;
  text: string;
  act: ActLabel;
  /** The raw DailyDialog act label, before relabeling - kept so the
   * report can state how many turns were touched. */
  rawAct: ActLabel;
  emotion: EmotionLabel;
}

const MANAGEMENT_ACTS = new Set<ActLabel>(["greeting", "closing", "backchannel"]);

export async function loadDailyDialogTestExamples(): Promise<{ examples: DailyDialogExample[]; relabeled: number }> {
  const conversations = await loadDailyDialogSplit(absolutePath("dailydialog/test.zip"), "test");
  const examples: DailyDialogExample[] = [];
  let relabeled = 0;
  for (const conv of conversations) {
    for (const turn of conv.sessions[0]!.turns) {
      const rawActLabel = DAILYDIALOG_ACT_ORDER[turn.act ?? -1];
      const emotionLabel = DAILYDIALOG_EMOTION_ORDER[turn.emotion ?? -1];
      if (!rawActLabel || !emotionLabel) continue; // an out-of-range label in the raw file: skipped, never guessed
      const text = turn.text.trim();
      if (!text) continue;

      let act: ActLabel = rawActLabel;
      if (rawActLabel === "inform") {
        const signal = classifyTurnSignal({ text, ageBand: "adult" });
        // MANAGEMENT_ACTS is a fixed subset of ACT_LABELS, so this check
        // alone already guarantees a valid ActLabel - classifyTurnSignal
        // cannot return anything outside the act enum by construction.
        if (MANAGEMENT_ACTS.has(signal.primary_act as ActLabel)) {
          act = signal.primary_act as ActLabel;
          relabeled++;
        }
      }
      examples.push({ turnId: turn.turnId ?? `${conv.id}`, text, act, rawAct: rawActLabel, emotion: emotionLabel });
    }
  }
  return { examples, relabeled };
}
