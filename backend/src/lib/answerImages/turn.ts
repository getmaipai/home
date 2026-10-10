// ANSWER-IMG-02: `show_images` inside a turn (design: data-scratch/research/
// chat-images-in-answers.md sections 4.3 and 5). The tool answers the model
// at once, so the phrasing round never waits on a picture fetch; the picture
// pipeline runs beside the answer. GENUI-05: when the pipeline settles, its
// set becomes one `image_gallery` answer block (gallery.ts) that goes through
// the same block filter as every package's blocks (manifest allowlist, spec
// check, hub picture address, age band, output floor) and joins the turn's
// block events; the one placer below then puts it at the first paragraph
// boundary of the released text after it is ready (before any text when it
// is ready in time), or after the text when the answer ends first. Nothing
// is placed above text already released, and nothing is reserved on
// speculation, so nothing on screen moves. A failed or empty fetch places
// nothing and the answer is whole (rule 6).
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";
import { atParagraphBoundary, paragraphCount, paragraphCut } from "@maipai/spec/interpreters/ts/paragraphs.js";
import type { AgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { TurnState } from "@/lib/turnMachine/contract";
import { getPersonSettingValue } from "@/lib/settings";
import { decide } from "@/lib/gate/decide";
import type { Role } from "@/middleware/auth";
import { blockEventsFor } from "@/lib/turnMachine/blockEvents";
import { nextHlc } from "@/lib/hlc";
import { galleryBlockFor } from "./gallery";
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
  /** The `show_images` call this pipeline answers (the block event carries it). */
  callId: string;
  /** Set once the pipeline settles: the set, or null for no pictures. */
  result?: AnswerImageSelection["set"];
  trace?: AnswerImageTrace;
  done: Promise<void>;
  /** The accepted `image_gallery` block event, once built; it is also in the turn's tool events. */
  block?: Extract<ToolStreamEvent, { t: "block" }>;
};

/** Section 4.3's one line, the same whatever the pipeline later finds: no
 * count, no bytes. ANSWER-IMG-05b kept it short (it is new prompt the
 * answering round must read before its first word). IMG-QUALITY-01a: the
 * 05b clause that let the model describe the subject "yourself if asked"
 * made it invent how the person looks in the pictures ("white glove and
 * fedora"); the model has not seen the photos, so it is told not to say
 * what they show or how the subject looks in them, and to answer other
 * questions from what it knows. Never mention the photos stays. */
export function showImagesResultLine(subject: string): string {
  return `Photos of ${subject} are on their screen. You have not seen them: do not say what they show or how ${subject} looks in them. Answer other questions from what you know; never mention the photos.`;
}
export const SHOW_IMAGES_UNAVAILABLE_LINE = "Photos cannot be shown here. Answer without mentioning photos.";

/** Rule 0's deterministic gates: never on a spoken or glance turn, a bare or
 * ephemeral turn, or a temporary chat (its memory-only picture cache is not
 * yet released with the chat); and, IMG-OFFER-01 (owner ruling 2026-10-10),
 * every band but an adult: a teen or a child is never offered the tool, even
 * for a child whose parent turned `reference.images` on. An adult is offered
 * it unless they turned the setting off. */
export function answerImagesAllowed(input: { actor: PersonRow; band: AgeBand; surfaceClass: SurfaceClass; spoken: boolean; temporary: boolean; bare: boolean; ephemeral: boolean }): boolean {
  if (input.band !== "adult") return false;
  if (input.surfaceClass !== "written" || input.spoken || input.temporary || input.bare || input.ephemeral) return false;
  const gate = decide({
    who: { personId: input.actor.id, role: input.actor.role as Role, band: input.band },
    what: { capabilities: ["tool.offer:show_images"] },
  });
  if (gate.kind !== "allow") return false;
  const value = getPersonSettingValue(input.actor, "reference.images");
  return value !== false;
}

/** Starts the pipeline for this turn's first `show_images` call; a second
 * call in the same turn reuses the first. */
export function startAnswerImages(state: TurnState, subject: string, kind = "", callId = ""): AnswerImageTurnState {
  if (state.answerImages) return state.answerImages;
  const roster = state.context.filter((c) => c.source === "roster").map((c) => c.text);
  const band = state.planBasis?.band ?? state.plan.age_band;
  const entry: AnswerImageTurnState = { subject, callId, done: Promise.resolve() };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<AnswerImageSelection>((resolve) => {
    timer = setTimeout(() => resolve({ set: null, trace: { subject, skipped: "error" } }), ANSWER_IMAGES_BUDGET_MS);
  });
  const deadlineAt = Date.now() + ANSWER_IMAGES_BUDGET_MS - ANSWER_IMAGES_FINISH_MS;
  entry.done = Promise.race([selectAnswerImages({ subject, kind, actor: state.actor, band, roster, deadlineAt }), budget])
    .catch((): AnswerImageSelection => ({ set: null, trace: { subject, skipped: "error" } }))
    .then((selection) => {
      clearTimeout(timer);
      entry.result = selection.set;
      entry.trace = selection.trace;
      addGalleryBlock(state, entry);
    });
  state.answerImages = entry;
  return entry;
}

/** The settled set as an `image_gallery` block event on the turn, through the one block filter. A set the filter
 * refuses (age band, output floor, a picture address that is not the hub's) leaves no block and the answer whole. */
function addGalleryBlock(state: TurnState, entry: AnswerImageTurnState): void {
  if (!entry.result) return;
  const raw = galleryBlockFor(entry.result, entry.subject, `show_images call ${entry.callId || "0"} in turn ${state.turnId}`, nextHlc());
  if (!raw) return;
  const [event] = blockEventsFor(state, SHOW_IMAGES_TOOL_ID, entry.callId, [raw], state.toolEvents);
  if (!event || event.t !== "block") return;
  entry.block = event;
  state.toolEvents.push(event);
}

/** A block placed in the reply: its stream event with `after_paragraph` stamped, and the released-text length it
 * goes after (Infinity: after the whole reply). Kept on the turn state in placement order (GENUI-13c). */
export type PlacedBlock = { event: Extract<ToolStreamEvent, { t: "block" }>; offset: number };

/** The `block` events of this turn that are ready (the tool round accepted them) and not yet placed. */
function pendingBlocks(state: TurnState): Array<Extract<ToolStreamEvent, { t: "block" }>> {
  const placed = new Set((state.placedBlocks ?? []).map((p) => p.event.block.id));
  return (state.toolEvents ?? []).flatMap((event) => (event.t === "block" && !placed.has(event.block.id) ? [event] : []));
}

/** Stamps `after_paragraph` on the block, in the turn's own event list (so the `block` event and the stored turn's
 * `blocks` carry it), and records where it goes. The hub is the only writer of this field (a package's value is
 * dropped at the host), and it never matches the block's words to the prose: only readiness and a paragraph boundary. */
function stampBlock(state: TurnState, event: Extract<ToolStreamEvent, { t: "block" }>, afterParagraph: number, offset: number): void {
  const stamped = { ...event, block: { ...event.block, after_paragraph: afterParagraph } };
  const index = state.toolEvents.indexOf(event);
  if (index >= 0) state.toolEvents[index] = stamped;
  (state.placedBlocks ??= []).push({ event: stamped, offset });
}

/** The one placer for anything ready to show in the reply, an answer block of any kind, a picture gallery included
 * (GENUI-13c; it grew out of the pictures-only placer of ANSWER-IMG-02, and GENUI-05 retired the separate picture path). Feeds released text through and places what is ready at the first
 * paragraph boundary after it became ready: before any text when it was ready in time, never above text already
 * released, never inside a code fence. `release` gets the text unchanged (a piece may be split at its paragraph
 * break, never altered), so the stored reply is still the concatenation of everything released (rule 9). Paragraphs
 * are counted and split by the spec's one helper, the same one every client uses. A visual that is not ready when
 * the answer ends is placed after the reply by `settleAnswerBlocks`. */
export class AnswerImagePlacer {
  private released = "";
  constructor(private readonly state: TurnState, private readonly release: (text: string) => void) {}

  push(text: string): void {
    if (!this.anythingReady()) {
      this.forward(text);
      return;
    }
    if (atParagraphBoundary(this.released)) {
      this.placeReady();
      this.forward(text);
      return;
    }
    const cut = paragraphCut(this.released, text);
    if (cut < 0) {
      this.forward(text);
      return;
    }
    this.forward(text.slice(0, cut));
    this.placeReady();
    if (cut < text.length) this.forward(text.slice(cut));
  }

  private anythingReady(): boolean {
    return pendingBlocks(this.state).length > 0;
  }

  private forward(text: string): void {
    this.released += text;
    this.release(text);
  }

  private placeReady(): void {
    const afterParagraph = paragraphCount(this.released);
    const offset = this.released.length;
    for (const event of pendingBlocks(this.state)) stampBlock(this.state, event, afterParagraph, offset);
  }
}

/** Places every block still waiting when the answer ends (it finished first, or nothing was ever released) after the
 * whole reply. Call before the turn's value is built, so the stored `blocks` carry their `after_paragraph`. */
export function settleAnswerBlocks(state: TurnState, replyText: string): void {
  const afterParagraph = paragraphCount(replyText);
  for (const event of pendingBlocks(state)) stampBlock(state, event, afterParagraph, Number.POSITIVE_INFINITY);
}

/** Waits for the picture pipeline (bounded by its own budget) before the turn's value is built, so a gallery that
 * finished late is among the turn's blocks to be placed after the reply. Records the drop counts on the call's own
 * trace detail (admin-only), never in the model's view. A gallery not yet placed is removed when the answer is not
 * kept (a refusal, a failed generation, an empty reply): pictures are never stored with those. Call before
 * `settleAnswerBlocks`. */
export async function settleAnswerImages(state: TurnState, input: { keep: boolean }): Promise<void> {
  const entry = state.answerImages;
  if (!entry) return;
  await entry.done;
  const call = state.outcomes.find((o) => o.packageId === SHOW_IMAGES_TOOL_ID && o.status === "succeeded");
  if (call && entry.trace) call.detail = JSON.stringify(entry.trace);
  const block = entry.block;
  if (input.keep || !block) return;
  // A gallery already placed (streamed with a paragraph) holds a stamped copy in the event list, so match by id.
  state.toolEvents = state.toolEvents.filter((e) => !(e.t === "block" && e.block.id === block.block.id));
  if (state.placedBlocks) state.placedBlocks = state.placedBlocks.filter((p) => p.event.block.id !== block.block.id);
}
