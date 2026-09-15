// ACT-02: the 4B labeling pass for the act and stance heads. Neither
// head can train on DailyDialog (CC BY-NC-SA, validation-only, per
// docs/dev.md section 12) or on a household transcript (never enters a
// repo), so the corpus is Taskmaster-1 + CCPE-M + the bench fixture +
// synthetic roster dialogues (all license-clean), labeled by the 4B
// under DailyDialog's own act definitions (Li et al. 2017: inform
// conveys information, question asks for it, directive asks the
// listener to do something including a suggestion or proposal,
// commissive commits the speaker to a future action) extended with our
// own three management acts and our own stance definitions
// (spec/schemas/turn-signal.schema.json's `stance` enum), matching the
// operational definitions turnSignal.ts's own rules already encode
// (clauseStance(), clauseAct()) so the training labels and the runtime
// rules agree on what each class means.
//
// Every call is reported as 4B-labeled, never as ground truth: the
// org's training rule ("validate on held-out real data, never the
// labeler's own output where a human label exists") means this corpus
// trains the weights and nothing else - the act head's acceptance
// number comes from DailyDialog's human act labels, and the stance
// head's from a person's own review of a 500-turn sample drawn from
// this same corpus (see reviewSheet.ts), never from the 4B agreeing
// with itself.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import type { JsonSchemaResponseFormat } from "@maipai/spec/llm/ts/types.js";
import { ACT_LABELS, STANCE_LABELS, type ActLabel, type StanceLabel } from "./labelSets";

export interface LabelCandidate {
  /** Stable across resumed runs: "<source>:<conversationId>:<turnIndex>". */
  id: string;
  text: string;
}

export interface LabeledTurn extends LabelCandidate {
  act: ActLabel;
  stance: StanceLabel;
}

const SYSTEM_PROMPT = `You label a single utterance a person said to a home voice assistant with two tags: its dialogue act and its stance.

ACT (DailyDialog's own definitions, Li et al. 2017, plus three management acts):
- inform: states or conveys information, an opinion, or a fact.
- question: asks for information, whether or not it ends in a question mark.
- directive: asks the listener to do something - an imperative, a request, a suggestion, or advice ("you should...", "let's...", "don't forget to...").
- commissive: commits the speaker to a future action of their own ("I'll...", "I promise...", "I'm going to...").
- greeting: opens the conversation (hello, hi, good morning).
- closing: ends the conversation (bye, goodnight, "that's all for now", a plain "thanks" with nothing else).
- backchannel: a short acknowledgment or reaction with no new content (ok, got it, wow, nice), one to three words.

STANCE (whose claim this is, and how literally to take it - only for a clause that actually asserts something; still pick the best fit for a question or directive):
- asserted: the speaker's own claim, stated as true.
- reported: relays what someone else said or believes, without a direct quote ("my sister says she hates cilantro").
- quoted: directly quotes another person's exact words (quotation marks, or "she said: ...").
- hypothetical: a conditional, a wish, or an imagined scenario, not asserted as true ("if it rains", "I wish I could", "what if we...").
- joke: said in jest, sarcastically, or ironically - not meant literally (a laugh token, "jk", an obvious exaggeration played for humor).

Label exactly the utterances given, in order, one act and one stance each. Never invent text, never merge or split utterances.`;

function responseSchema(n: number): JsonSchemaResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: "turn_labels",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["labels"],
        properties: {
          labels: {
            type: "array",
            minItems: n,
            maxItems: n,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["act", "stance"],
              properties: {
                act: { type: "string", enum: ACT_LABELS },
                stance: { type: "string", enum: STANCE_LABELS },
              },
            },
          },
        },
      },
    },
  };
}

function isActLabel(v: unknown): v is ActLabel {
  return typeof v === "string" && (ACT_LABELS as readonly string[]).includes(v);
}
function isStanceLabel(v: unknown): v is StanceLabel {
  return typeof v === "string" && (STANCE_LABELS as readonly string[]).includes(v);
}

/** One 4B call per batch. Throws on a malformed or wrong-length response -
 * the caller decides whether to retry or skip the batch, never silently
 * pads with a guessed label. */
async function labelOneBatch(client: LlamaServerClient, batch: readonly LabelCandidate[]): Promise<Array<{ act: ActLabel; stance: StanceLabel }>> {
  const userText = batch.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
  const response = await client.chatComplete({
    model: "background",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Label these ${batch.length} utterances:\n${userText}` },
    ],
    response_format: responseSchema(batch.length),
    temperature: 0,
  });
  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error("4B returned no content for a labeling batch");
  const parsed = JSON.parse(content) as { labels?: unknown[] };
  const labels = parsed.labels;
  if (!Array.isArray(labels) || labels.length !== batch.length) {
    throw new Error(`4B returned ${Array.isArray(labels) ? labels.length : "non-array"} labels for a batch of ${batch.length}`);
  }
  return labels.map((raw, i) => {
    const l = raw as { act?: unknown; stance?: unknown };
    if (!isActLabel(l.act) || !isStanceLabel(l.stance)) throw new Error(`4B returned an invalid label at position ${i + 1}: ${JSON.stringify(raw)}`);
    return { act: l.act, stance: l.stance };
  });
}

export interface LabelRunOptions {
  batchSize: number;
  /** Sequential by default: the background engine is spawned with one
   * slot (backgroundLaunchArgs names no --parallel), so concurrent
   * requests would only queue behind each other on the server side -
   * concurrency here would add complexity for no real throughput. */
  onProgress?: (done: number, total: number) => void;
}

/** Resumable: `outPath` is a JSONL file, one labeled turn per line,
 * appended as each batch completes so a harness kill loses at most one
 * in-flight batch. Candidates whose `id` already has a line in the file
 * are skipped on the next run - the same per-shard resume shape
 * replay-per-question.ts uses for EVAL-07. */
export async function labelActStanceCorpus(client: LlamaServerClient, candidates: readonly LabelCandidate[], outPath: string, opts: LabelRunOptions): Promise<{ labeled: number; failed: number }> {
  mkdirSync(dirname(outPath), { recursive: true });
  const already = new Set<string>();
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        already.add((JSON.parse(line) as { id: string }).id);
      } catch {
        // A truncated last line from a killed run: ignored, re-labeled on this pass.
      }
    }
  }
  const remaining = candidates.filter((c) => !already.has(c.id));
  console.log(`  labeling corpus: ${already.size} already done, ${remaining.length} remaining (batch size ${opts.batchSize})`);

  let labeled = already.size;
  let failed = 0;
  for (let start = 0; start < remaining.length; start += opts.batchSize) {
    const batch = remaining.slice(start, start + opts.batchSize);
    try {
      const results = await labelOneBatch(client, batch);
      const lines = batch.map((c, i) => JSON.stringify({ id: c.id, text: c.text, act: results[i]!.act, stance: results[i]!.stance } satisfies LabeledTurn)).join("\n") + "\n";
      appendFileSync(outPath, lines);
      labeled += batch.length;
    } catch (err) {
      // One bad batch (malformed JSON, a wrong-length reply) never aborts
      // the whole corpus - it is dropped and the run continues past it,
      // the same "certain data, or drop it" rule the org's training
      // section states for unverifiable audio, applied here to an
      // unverifiable labeling response.
      console.error(`  batch at ${start} failed: ${err instanceof Error ? err.message : err}`);
      failed += batch.length;
    }
    opts.onProgress?.(labeled + failed, candidates.length);
  }
  return { labeled, failed };
}

/** Tolerant of a truncated trailing line the same way the resume scan in
 * `labelActStanceCorpus` already is (a code review, 2026-09-14, caught
 * this function throwing uncaught on exactly the garbled line that scan
 * is designed to survive): a harness kill mid-write leaves that line
 * behind, unremoved, forever - a caller reading the finished corpus
 * after the labeling pass completes must not crash on it either. */
export function readLabeledCorpus(outPath: string): LabeledTurn[] {
  if (!existsSync(outPath)) return [];
  const rows: LabeledTurn[] = [];
  for (const line of readFileSync(outPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as LabeledTurn);
    } catch {
      // A truncated line from a killed run: skipped, not fatal.
    }
  }
  return rows;
}
