// ACT-02: GoEmotions (Apache 2.0) loading, unchanged from the emotion-
// only draft (../../../../home-codex-act02/backend/scripts/train/
// turn-signal-heads.ts) - the only head with real human labels to train
// on directly, no 4B pass needed.
import { readFileSync } from "node:fs";
import { GOEMOTIONS_TO_EKMAN, type EmotionLabel } from "./labelSets";

export interface LabeledExample {
  text: string;
  label: EmotionLabel;
}

export function readEmotionsList(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface GoEmotionsLoadResult {
  examples: LabeledExample[];
  totalRows: number;
  /** Rows carrying more than one raw GoEmotions label index: dropped
   * outright, never coalesced even when every index happens to land in
   * the same Ekman bucket. */
  droppedAmbiguous: number;
  droppedUnmapped: number;
}

/** Each GoEmotions row carries one or more of its 27 categories plus
 * `neutral`, comma-separated indices into emotions.txt. A multi-target
 * row is dropped outright: our head predicts one `expressed_emotion`
 * per clause, so a row annotated with more than one label has no single
 * correct answer for a multinomial head. */
export function loadGoEmotionsFile(path: string, emotionsByIndex: readonly string[]): GoEmotionsLoadResult {
  const examples: LabeledExample[] = [];
  let totalRows = 0;
  let droppedAmbiguous = 0;
  let droppedUnmapped = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const text = parts[0]!.trim();
    const indices = parts[1]!.split(",").map((s) => Number(s.trim()));
    if (!text || indices.some((i) => !Number.isFinite(i))) continue;
    totalRows++;
    if (indices.length > 1) {
      droppedAmbiguous++;
      continue;
    }
    const name = emotionsByIndex[indices[0]!];
    const mapped = name ? GOEMOTIONS_TO_EKMAN[name] : undefined;
    if (!mapped) {
      droppedUnmapped++;
      continue;
    }
    examples.push({ text, label: mapped });
  }
  return { examples, totalRows, droppedAmbiguous, droppedUnmapped };
}
