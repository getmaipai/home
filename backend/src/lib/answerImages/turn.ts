// ANSWER-IMG-02: `show_images` inside a turn (design: data-scratch/research/
// chat-images-in-answers.md sections 4.3 and 5). Automatic lead images and
// explicit show_images calls run beside the answer. GENUI-05: when the pipeline settles, its
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
import { shownPicturesIn } from "@/lib/conversationHistory";
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
  /** True only for the resolver's deterministic one-picture lead path. */
  automaticLead?: boolean;
  /** An explicit call can take ownership while this automatic lookup is still settling. */
  superseded?: boolean;
  /** The `show_images` call this pipeline answers (the block event carries it). */
  callId: string;
  /** Set once the pipeline settles: the set, or null for no pictures. */
  result?: AnswerImageSelection["set"];
  trace?: AnswerImageTrace;
  done: Promise<void>;
  /** The accepted `image_gallery` block event, once built; it is also in the turn's tool events. */
  block?: Extract<ToolStreamEvent, { t: "block" }>;
  /** SEARCH-IMAGES-01: the other names of a `subjects` call, each its own one-picture pipeline. */
  extras?: AnswerImageTurnState[];
};

/** SEARCH-IMAGES-01: the most names one `show_images` call may ask for, and how many run at once. */
export const SHOW_IMAGES_MAX_SUBJECTS = 5;
const SUBJECTS_CONCURRENCY = 3;

/** The call's names: `subject` first, then `subjects`, trimmed, case-insensitively deduped, capped. */
export function showImagesNames(subject: string, subjects?: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const raw = [subject, ...(Array.isArray(subjects) ? subjects : [])];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= SHOW_IMAGES_MAX_SUBJECTS) break;
  }
  return out;
}

/** Section 4.3's success line, sent only after a validated picture exists.
 * No count or bytes reach the model. IMG-QUALITY-01a: the
 * 05b clause that let the model describe the subject "yourself if asked"
 * made it invent how the person looks in the pictures ("white glove and
 * fedora"); the model has not seen the photos, so it is told not to say
 * what they show or how the subject looks in them, and to answer other
 * questions from what it knows. Never mention the photos stays. */
export function showImagesResultLine(subject: string, count = 1): string {
  const visible = count === 1 ? `One picture of ${subject} is on their screen.` : `${count} pictures of ${subject} are on their screen.`;
  return `${visible} You have not seen them: do not say what they show or how ${subject} looks in them. Answer other questions from what you know; never mention the pictures. Do not call show_images again or write its subject or kind in your reply.`;
}
/** The picture lookup is still running when the model needs to start its answer. */
export function showImagesPendingResultLine(subject: string): string {
  return `I'm checking for pictures of ${subject}. They may appear below when ready. You have not seen them: do not say what they show or how ${subject} looks in them. Answer other questions from what you know; do not claim pictures are visible or call show_images again.`;
}
export function showImagesEmptyResultLine(subject: string, reason?: AnswerImageTrace["skipped"]): string {
  if (reason === "offline") return `The picture sources are unavailable. Tell the person you could not show a picture of ${subject}, and offer to try again or open the Wikipedia page. Answer any other part of the question from what you know. Do not claim a picture is visible. Do not call show_images again or write its subject or kind in your reply.`;
  if (reason === "error") return `The picture lookup failed. Tell the person you could not show a picture of ${subject}, and offer to try again or open the Wikipedia page. Answer any other part of the question from what you know. Do not claim a picture is visible. Do not call show_images again or write its subject or kind in your reply.`;
  return `No picture was found or passed the checks for ${subject}. Tell the person you could not show a poster or picture, and offer to try again or open the Wikipedia page. Answer any other part of the question from what you know. Do not claim a picture is visible. Do not call show_images again or write its subject or kind in your reply.`;
}
export function answerImageFailureKind(reason?: AnswerImageTrace["skipped"]): "unavailable" | "errored" | "found_nothing" {
  if (reason === "offline") return "unavailable";
  if (reason === "error") return "errored";
  return "found_nothing";
}
/** SEARCH-IMAGES-02: the line for a `subjects` call, built from the names
 * whose pipelines produced a visible set and the names that did not. */
export function showImagesMultiResultLine(shown: string[], missing: string[] = []): string {
  if (shown.length === 0) return `No picture was found or passed the checks for ${missing.join(", ")}. Tell the person you could not show those pictures, and offer to try again or open the Wikipedia page. Answer any other part of the question from what you know. Do not claim pictures are visible. Do not call show_images again or write its subjects or kind in your reply.`;
  const visible = shown.length === 1 ? `One picture of ${shown[0]} is on their screen.` : `${shown.length} pictures of ${shown.join(", ")} are on their screen.`;
  const none = missing.length ? ` No picture was found or passed the checks for ${missing.join(", ")}; tell the person you could not show those pictures and offer to try again or open the Wikipedia page.` : "";
  return `${visible}${none} You have not seen the pictures: do not say what they show or how any subject looks in them. Answer other questions from what you know; never mention the pictures. Do not call show_images again or write its subjects or kind in your reply.`;
}
export const SHOW_IMAGES_UNAVAILABLE_LINE ="Photos cannot be shown here. Answer without mentioning photos.";

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

/** Eligibility for the deterministic one-picture offer. It uses the same
 * capability, person preference, written-chat, and privacy gates as the
 * model-offered tool; the selector applies the same band-specific source
 * and content checks. */
export function autoLeadImageAllowed(input: { actor: PersonRow; band: AgeBand; surfaceClass: SurfaceClass; spoken: boolean; temporary: boolean; bare: boolean; ephemeral: boolean }): boolean {
  if (input.surfaceClass !== "written" || input.spoken || input.temporary || input.bare || input.ephemeral) return false;
  const gate = decide({
    who: { personId: input.actor.id, role: input.actor.role as Role, band: input.band },
    what: { capabilities: ["tool.offer:show_images"] },
  });
  if (gate.kind !== "allow") return false;
  return getPersonSettingValue(input.actor, "chat.auto_lead_image") !== false && getPersonSettingValue(input.actor, "reference.images") !== false;
}

/** Starts the pipeline for this turn's first `show_images` call; a second call in the same turn reuses the first.
 * SEARCH-IMAGES-01: with more than one distinct name each name gets one picture (its own small gallery block, under
 * the answer like any other), run at most three at a time; no model call, and the per-host pace is the fetch
 * module's own shared state, so parallel names are paced together. */
export function startAnswerImages(state: TurnState, subject: string, kind = "", callId = "", subjects?: unknown, singleLead = false): AnswerImageTurnState {
  if (state.answerImages) {
    // A model-selected show_images call owns the gallery even if the
    // resolver's automatic lead started while the model was deciding.
    // Invalidate its pending result and remove it if it has not streamed yet.
    if (callId !== "auto-lead-image" && state.answerImages.automaticLead) {
      const previous = state.answerImages;
      previous.superseded = true;
      for (const entry of [previous, ...(previous.extras ?? [])]) {
        const blockId = entry.block?.block.id;
        if (!blockId) continue;
        state.toolEvents = state.toolEvents.filter((event) => !(event.t === "block" && event.block.id === blockId));
        if (state.placedBlocks) state.placedBlocks = state.placedBlocks.filter((placed) => placed.event.block.id !== blockId);
      }
      state.answerImages = undefined;
    } else {
      return state.answerImages;
    }
  }
  // Only the resolver's automatic lead is a one-picture result. Keep this
  // tied to its internal call identity so explicit show_images calls always
  // retain the selected gallery, even if a caller passes the legacy flag.
  const automaticLead = singleLead && callId === "auto-lead-image";
  const names = showImagesNames(subject, subjects);
  if (names.length === 0) names.push(subject);
  const many = names.length > 1;
  const roster = state.context.filter((c) => c.source === "roster").map((c) => c.text);
  const band = state.planBasis?.band ?? state.plan.age_band;
  // IMG-QUALITY-01b: a failed read of the shown set is an empty set, never a failed turn (rule 6).
  let shown: ReturnType<typeof shownPicturesIn> | undefined;
  try { shown = shownPicturesIn(state.conversationId); } catch { shown = undefined; }
  const entries = names.map((name): AnswerImageTurnState => ({ subject: name, callId, ...(automaticLead ? { automaticLead: true } : {}), done: Promise.resolve() }));
  const run = (entry: AnswerImageTurnState): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<AnswerImageSelection>((resolve) => {
      timer = setTimeout(() => resolve({ set: null, trace: { subject: entry.subject, skipped: "error" } }), ANSWER_IMAGES_BUDGET_MS);
    });
    const deadlineAt = Date.now() + ANSWER_IMAGES_BUDGET_MS - ANSWER_IMAGES_FINISH_MS;
    return Promise.race([selectAnswerImages({ subject: entry.subject, kind: many ? "" : kind, actor: state.actor, band, roster, deadlineAt, ...(shown ? { shown } : {}) }), budget])
      .catch((): AnswerImageSelection => ({ set: null, trace: { subject: entry.subject, skipped: "error" } }))
      .then((selection) => {
        clearTimeout(timer);
        if (entry.superseded) return;
        // A multi-subject show_images call has one picture per requested
        // name. A single-subject explicit call keeps its complete gallery;
        // only the automatic lead is reduced to one picture.
        entry.result = selection.set && automaticLead
          ? { ...selection.set, visible: 1, items: selection.set.items.slice(0, 1) }
          : selection.set && many
            ? { ...selection.set, visible: 1, items: selection.set.items.slice(0, 1) }
            : selection.set;
        entry.trace = selection.trace;
        addGalleryBlock(state, entry);
      });
  };
  if (!many) {
    entries[0]!.done = run(entries[0]!);
  } else {
    const queue = [...entries];
    const worker = async (): Promise<void> => { for (let e = queue.shift(); e; e = queue.shift()) await run(e); };
    const all = Promise.all(Array.from({ length: Math.min(SUBJECTS_CONCURRENCY, queue.length) }, worker)).then(() => undefined);
    for (const e of entries) e.done = all;
    entries[0]!.extras = entries.slice(1);
  }
  state.answerImages = entries[0]!;
  return entries[0]!;
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
  private heldAutoLeadText = "";
  constructor(private readonly state: TurnState, private readonly release: (text: string) => void) {}

  push(text: string): void {
    if (this.state.pendingAutoLeadImage) {
      this.heldAutoLeadText += text;
      return;
    }
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

  /** The model has either chosen its plain answer or explicitly called show_images. */
  releaseAutomaticLead(withImage: boolean): void {
    this.state.pendingAutoLeadImage = undefined;
    if (withImage && pendingBlocks(this.state).length > 0) this.placeReady();
    const held = this.heldAutoLeadText;
    this.heldAutoLeadText = "";
    if (held) this.push(held);
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
  for (const event of pendingBlocks(state)) {
    const entry = [state.answerImages, ...(state.answerImages?.extras ?? [])].find((candidate) => candidate?.block?.block.id === event.block.id);
    stampBlock(state, event, entry?.automaticLead ? 0 : afterParagraph, entry?.automaticLead ? 0 : Number.POSITIVE_INFINITY);
  }
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
  const all = [entry, ...(entry.extras ?? [])];
  const call = state.outcomes.find((o) => o.packageId === SHOW_IMAGES_TOOL_ID);
  if (call && entry.trace) {
    call.detail = JSON.stringify(all.length > 1 ? all.map((e) => e.trace) : entry.trace);
    const shown = all.reduce((total, one) => total + (one.block ? (one.result?.visible ?? 0) : 0), 0);
    if (shown === 0 && call.status === "succeeded") { call.status = "failed"; call.failureKind = answerImageFailureKind(entry.trace.skipped); }
  }
  if (input.keep) return;
  for (const one of all) {
    const block = one.block;
    if (!block) continue;
    // A gallery already placed (streamed with a paragraph) holds a stamped copy in the event list, so match by id.
    state.toolEvents = state.toolEvents.filter((e) => !(e.t === "block" && e.block.id === block.block.id));
    if (state.placedBlocks) state.placedBlocks = state.placedBlocks.filter((p) => p.event.block.id !== block.block.id);
  }
}
