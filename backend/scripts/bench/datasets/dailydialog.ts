// Converts DailyDialog's own three line-aligned text files (the
// dialogue, its acts, its emotions - one dialogue per line, `__eou__`
// separating turns) into this directory's internal form. The raw files
// ship inside per-split zips (train.zip, validation.zip, test.zip);
// `parseDailyDialog` takes their already-extracted text so the actual
// parsing logic never depends on a zip being present, which is what
// keeps the loader's own unit test small, offline and file-free.
import type { DatasetConversation, DatasetTurn } from "./types";

const TURN_SEPARATOR = "__eou__";

/** DailyDialog's own numbering (Li et al. 2017): acts 1-4 are inform,
 * question, directive, commissive; emotions 0-6 are neutral, anger,
 * disgust, fear, happiness, sadness, surprise - dev.md section 12's
 * own DailyDialog label mapping, carried through unchanged rather than
 * relabeled here (ACT-01's own rule pass does that relabeling when it
 * validates against this reference, not this loader). */
export function parseDailyDialog(dialoguesText: string, actsText: string, emotionsText: string, split: string): DatasetConversation[] {
  const dialogueLines = dialoguesText.split("\n").filter((line) => line.trim().length > 0);
  const actLines = actsText.split("\n").filter((line) => line.trim().length > 0);
  const emotionLines = emotionsText.split("\n").filter((line) => line.trim().length > 0);

  if (dialogueLines.length !== actLines.length || dialogueLines.length !== emotionLines.length) {
    throw new Error(
      `dailydialog's three files for "${split}" disagree on line count (dialogues ${dialogueLines.length}, acts ${actLines.length}, emotions ${emotionLines.length}) - they are meant to be aligned one dialogue per line`,
    );
  }

  return dialogueLines.map((dialogueLine, lineIndex) => {
    const texts = dialogueLine.split(TURN_SEPARATOR).map((t) => t.trim()).filter((t) => t.length > 0);
    const acts = actLines[lineIndex]!.trim().split(/\s+/).map(Number);
    const emotions = emotionLines[lineIndex]!.trim().split(/\s+/).map(Number);
    if (texts.length !== acts.length || texts.length !== emotions.length) {
      throw new Error(
        `dailydialog "${split}" line ${lineIndex}: ${texts.length} turns but ${acts.length} acts and ${emotions.length} emotions`,
      );
    }

    const turns: DatasetTurn[] = texts.map((text, turnIndex) => ({
      turnId: `${split}-${lineIndex}:${turnIndex}`,
      // No speaker names in the raw files - two people, strictly
      // alternating (the dataset's own convention), so A/B is the
      // honest label rather than inventing names this loader has no
      // basis for.
      speaker: turnIndex % 2 === 0 ? "A" : "B",
      text,
      act: acts[turnIndex]!,
      emotion: emotions[turnIndex]!,
      isEvidence: false,
    }));

    return {
      id: `dailydialog-${split}-${lineIndex}`,
      source: "dailydialog" as const,
      modality: "text" as const,
      sessions: [{ sessionId: `dailydialog-${split}-${lineIndex}-session`, timestamp: null, turns }],
    };
  });
}

/** Reads one split's three files straight out of its zip via the
 * system `unzip` (no extraction to disk, no new dependency - the same
 * "download, never vendor" spirit applied to not even unpacking the
 * archive further than a read needs). */
export async function loadDailyDialogSplit(zipPath: string, split: "train" | "validation" | "test"): Promise<DatasetConversation[]> {
  async function readEntry(name: string): Promise<string> {
    const proc = Bun.spawn(["unzip", "-p", zipPath, `${split}/${name}`], { stdout: "pipe", stderr: "pipe" });
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) throw new Error(`unzip -p ${zipPath} ${split}/${name} failed (exit ${code})`);
    return text;
  }

  const [dialogues, acts, emotions] = await Promise.all([
    readEntry(`dialogues_${split}.txt`),
    readEntry(`dialogues_act_${split}.txt`),
    readEntry(`dialogues_emotion_${split}.txt`),
  ]);

  return parseDailyDialog(dialogues, acts, emotions, split);
}
