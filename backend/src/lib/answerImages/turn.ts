// ANSWER-IMG-02: `show_images` inside a turn (design: data-scratch/research/
// chat-images-in-answers.md sections 4.3 and 5). The tool answers the model
// at once, so the phrasing round never waits on a picture fetch; the picture
// pipeline runs beside the answer; the set is placed at the first paragraph
// boundary of the released text after it is ready (before any text when it
// is ready in time), or after the text when the answer ends first. Nothing
// is placed above text already released, and nothing is reserved on
// speculation, so nothing on screen moves. A failed or empty fetch places
// nothing and the answer is whole (rule 6).
import type { AnswerImageSet } from "@/wire";
import type { AgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { TurnState } from "@/lib/turnMachine/contract";
import { getPersonSettingSource, getPersonSettingValue } from "@/lib/settings";
import { selectAnswerImages, type AnswerImageSelection, type AnswerImageTrace } from "./select";

/** The model-facing tool name; the bundled package `backend/packages/show_images`
 * holds its description and argument schema (one definition). */
export const SHOW_IMAGES_TOOL_ID = "show_images";
/** The whole pipeline's wall budget beside the answer; past it, no pictures. */
export const ANSWER_IMAGES_BUDGET_MS = 4_000;
/** The part of that budget kept for validating and caching what arrived:
 * the picture fetch stops this long before the budget ends (ANSWER-IMG-05,
 * measured 2026-10-06: about 175 ms per 1280 px photo, four at a time). */
const ANSWER_IMAGES_FINISH_MS = 1_000;

export type AnswerImageTurnState = {
  subject: string;
  /** Set once the pipeline settles: the set, or null for no pictures. */
  result?: AnswerImageSelection["set"];
  trace?: AnswerImageTrace;
  done: Promise<void>;
  /** Where the set landed, once placed; `offset` is the released-text
   * length it sits after (Infinity: after the whole answer). */
  placed?: { set: AnswerImageSet; offset: number };
};

/** Section 4.3's one line, the same whatever the pipeline later finds: no
 * count, no bytes, and the model is told never to mention them. */
export function showImagesResultLine(subject: string): string {
  return `Photos of ${subject} will be shown above or beside your answer if good ones are found. The person sees them without your help: never mention photos, pictures, images or search results in your answer, and never describe, list or link them.`;
}
export const SHOW_IMAGES_UNAVAILABLE_LINE = "Photos cannot be shown here. Answer without mentioning photos.";

/** Rule 0's deterministic gates: never on a spoken or glance turn, a bare or
 * ephemeral turn, or a temporary chat (its memory-only picture cache is not
 * yet released with the chat); a child only once an adult has turned
 * `reference.images` on for them (owner, 2026-10-06: off by default); a teen
 * or adult unless they turned it off. */
export function answerImagesAllowed(input: { actor: PersonRow; band: AgeBand; surfaceClass: SurfaceClass; spoken: boolean; temporary: boolean; bare: boolean; ephemeral: boolean }): boolean {
  if (input.surfaceClass !== "written" || input.spoken || input.temporary || input.bare || input.ephemeral) return false;
  const value = getPersonSettingValue(input.actor, "reference.images");
  if (input.band === "child") return Boolean(getPersonSettingSource(input.actor.id, "reference.images")) && value === true;
  return value !== false;
}

/** Starts the pipeline for this turn's first `show_images` call; a second
 * call in the same turn reuses the first. */
export function startAnswerImages(state: TurnState, subject: string): AnswerImageTurnState {
  if (state.answerImages) return state.answerImages;
  const roster = state.context.filter((c) => c.source === "roster").map((c) => c.text);
  const band = state.planBasis?.band ?? state.plan.age_band;
  const entry: AnswerImageTurnState = { subject, done: Promise.resolve() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<AnswerImageSelection>((resolve) => {
    timer = setTimeout(() => resolve({ set: null, trace: { subject, skipped: "error" } }), ANSWER_IMAGES_BUDGET_MS);
  });
  const deadlineAt = Date.now() + ANSWER_IMAGES_BUDGET_MS - ANSWER_IMAGES_FINISH_MS;
  entry.done = Promise.race([selectAnswerImages({ subject, actor: state.actor, band, roster, deadlineAt }), budget])
    .catch((): AnswerImageSelection => ({ set: null, trace: { subject, skipped: "error" } }))
    .then((selection) => {
      clearTimeout(timer);
      entry.result = selection.set;
      entry.trace = selection.trace;
    });
  state.answerImages = entry;
  return entry;
}

const PARAGRAPH_BREAK = /\n[ \t]*\n\s*/;

/** A blank line inside an open ``` block is not a paragraph boundary: the
 * pictures never split a code block. */
function insideCodeFence(text: string): boolean {
  return ((text.match(/```/g) ?? []).length % 2) === 1;
}

function paragraphsIn(text: string): number {
  return text.split(PARAGRAPH_BREAK).filter((p) => p.trim().length > 0).length;
}

/** Feeds released text through and places a ready set at the first
 * paragraph boundary: `release` gets the text unchanged (a piece may be
 * split at its paragraph break, never altered), so the stored reply is
 * still the concatenation of everything released (rule 9). */
export class AnswerImagePlacer {
  private released = "";
  constructor(private readonly state: TurnState, private readonly release: (text: string) => void) {}

  push(text: string): void {
    const entry = this.state.answerImages;
    if (!entry?.result || entry.placed) {
      this.forward(text);
      return;
    }
    if (this.released.trim().length === 0 || (/\n[ \t]*\n\s*$/.test(this.released) && !insideCodeFence(this.released))) {
      this.place(entry);
      this.forward(text);
      return;
    }
    const brk = PARAGRAPH_BREAK.exec(text);
    if (!brk || insideCodeFence(this.released + text.slice(0, brk.index + brk[0].length))) {
      this.forward(text);
      return;
    }
    const cut = brk.index + brk[0].length;
    this.forward(text.slice(0, cut));
    this.place(entry);
    if (cut < text.length) this.forward(text.slice(cut));
  }

  private forward(text: string): void {
    this.released += text;
    this.release(text);
  }

  private place(entry: AnswerImageTurnState): void {
    entry.placed = { set: { ...entry.result!, after_paragraph: paragraphsIn(this.released) }, offset: this.released.length };
  }
}

/** Waits for the pipeline (bounded by its own budget) and returns the set
 * that goes with the stored reply: where it was placed mid-stream, or after
 * the whole answer when the answer finished first. Records the drop counts
 * on the call's own trace detail (admin-only), never in the model's view. */
export async function settleAnswerImages(state: TurnState, replyText: string): Promise<AnswerImageSet | undefined> {
  const entry = state.answerImages;
  if (!entry) return undefined;
  await entry.done;
  const call = state.outcomes.find((o) => o.packageId === SHOW_IMAGES_TOOL_ID && o.status === "succeeded");
  if (call && entry.trace) call.detail = JSON.stringify(entry.trace);
  if (entry.placed) return entry.placed.set;
  if (!entry.result || replyText.trim().length === 0) return undefined;
  entry.placed = { set: { ...entry.result, after_paragraph: paragraphsIn(replyText) }, offset: Number.POSITIVE_INFINITY };
  return entry.placed.set;
}
