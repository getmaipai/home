import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { File as FileRecord } from "@maipai/spec/gen/ts/file.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { conversationTurns, conversations } from "./db/schema";
// hardware.ts has zero "@/"-aliased imports of its own, unlike backup.ts
// and modelCatalog.ts below, so its types are re-exported directly
// instead of hand-copied a second time.
export type { HardwareInfo, CudaDevice } from "./lib/hardware";
// APP-SET-02: what a child or teen saw in Settings before the per-app areas.
export { minorVisibleSettingKeys } from "./lib/settingsMinorSnapshot";

// The wire shapes a browser client needs, kept alias-free (relative
// imports only, never "@/...") so frontend/src/lib/api.ts can import this
// file directly through the @maipai/home-backend workspace dependency:
// backend's own tsconfig "@/*" path mapping does not apply when frontend's
// tsc resolves a file pulled in from another package (a code review,
// 2026-09-04, caught this exact mirror-can-drift risk when these three
// shapes were still hand-duplicated in api.ts; the first fix attempt
// re-exported the real files directly and failed to typecheck for
// exactly this reason). the retired turn engine, conversationHistory.ts, and
// personShape.ts re-export from here rather than defining these inline,
// so there is still exactly one definition, just relocated to the one
// file both a "@/"-aliased backend module and an external package can
// both resolve.

// hasPasskeys added in step 6: a passkey-only profile (no PIN/password
// at all) needs its own signal, distinct from hasSecret, so a client can
// tell "bare-tap profile" apart from "needs its passkey" apart from
// "needs its PIN/password". Optional in the type (never omitted by the
// real routes, which always send it) so this stays an additive API
// change per CLAUDE.md > Compatibility - existing frontend fixtures/
// mocks built before step 6 that construct a Roster literal without it
// keep compiling, rather than every one of them needing an edit the
// moment this field was added.
export type Roster = Omit<Person, "birthdate"> & { hasSecret: boolean; hasPasskeys?: boolean; age_band?: "child" | "teen" | "adult" };

/** One row of a spec-sheet Element's own prop shape, exactly
 * (assistant-ui.com/elements/spec-sheet: `title`, `subtitle?`,
 * `rows: {label, value, emphasis?}[]`) - kept identical on purpose so a
 * frontend spec-sheet tool render passes this object straight through. */
export interface SpecSheetRow {
  label: string;
  value: string;
  emphasis?: boolean;
}

/** The generative-UI contract's structured part: a tool's result, shaped
 * for the one Element that renders it, never Home-drawn prose. `kind`
 * only ever grows (a chart/data-table kind lands the same way once a
 * producer needs it) - never a field Home invents ahead of a real one.
 * `tool_id` (SHELL-02 slice 3): the producing package's own id
 * (composer.ts's `structuredPartForOutcomes()`, "weather" or
 * "almanac-date" today) - the frontend's own tool-call message part
 * needs a real, honest `toolName` to key its Element render on, never
 * a name it invents. */
export type StructuredPart = { kind: "spec_sheet"; tool_id: string; title: string; subtitle?: string; rows: SpecSheetRow[] };

export interface TurnReply {
  text: string;
  speech?: string;
}
/** ANSWER-IMG-02: one validated picture in an answer. `src` and `full` are
 * always the hub's own `/api/answer-image/` route (the browser never loads a
 * picture's host); `width`/`height` size the tile before the bytes paint. */
export interface AnswerImageItem {
  id: string;
  src: string;
  full: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  source: { title: string; site: string; url: string };
  license?: { short: string; url?: string; artist?: string };
}
/** ANSWER-IMG-02: the picture set of one answer, the `images` event's payload
 * and the stored `answer_images`. `after_paragraph` is how many paragraphs of
 * released text came before it (0 = before any text); `visible` tiles show
 * and the badge is `items.length - visible` (never 1: a lone extra is dropped). */
export interface AnswerImageSet { layout: "row"; after_paragraph: number; visible: number; items: AnswerImageItem[] }

export interface TurnStats {
  prompt_tokens: number | null;
  predicted_tokens: number | null;
  tokens_per_second: number | null;
  time_to_first_token_ms: number | null;
  total_time_ms: number | null;
  context_tokens: number | null;
  /** The Stack's reported per-slot chat context for this turn. Null when
   * the engine did not report a size; the safe window fallback is not a
   * measured context size. */
  context_window_tokens?: number | null;
  context_used_percent?: number | null;
  /** THIN-3C may attach measured prompt segments when available. */
  context_segments?: Partial<Record<"prefix" | "tools" | "memory" | "history" | "reply", number>>;
  cache_reuse_tokens: number | null;
  cache_reuse_percent: number | null;
  engine: string | null;
  stop_reason: string | null;
  // ADMIN-COMPARE-01: whether this turn's own completion ran with
  // thinking on - read back for the "ours" trace column, alongside the
  // rest of this already-JSON stats blob (no migration: the same reason
  // every other field here needed none).
  thinking: boolean;
  /** LAT-00: every real model call this turn made, oldest first - the
   * fields above summarize the LAST one (unchanged shape/meaning for
   * every existing reader); this is the full history, so a turn that
   * spent a hidden second (or third) generation shows it. */
  generations: TurnGeneration[];
  /** U2 (turn-machine-state-record-2026-09-22.md, "What every turn
   * writes"): one entry per node the new path (turnNext.ts) ran or
   * skipped, in order, beside `generations` above - "one trace, not a
   * second log." Absent (undefined, never an empty array standing in
   * for "didn't run") on every row the old path (the retired turn engine) still
   * produces; PERF-ALERT-01's stage split and `scripts/bench/replay.ts`
   * both read this only when it's present. Deliberately structural,
   * the same reason TurnGeneration above is hand-declared rather than
   * imported: this file stays alias-free (frontend/src/lib/api.ts
   * imports it directly), so it never reaches into
   * turnMachine/contract.ts's own NodeExecution, which pulls in
   * backend-only modules by "@/..." alias frontend cannot resolve.
   * turnMachine/trace.ts's own NodeExecution shape and this one are
   * kept in step by hand, not by a shared import. */
  nodes?: TurnNodeExecution[];
}

/** LAT-00: one real model call, projected to plain values for the wire -
 * see the retired turn engine's GenerationRecord for the working shape this comes
 * from (a live stats reference, read once settled). */
export interface TurnGeneration {
  reason: string;
  thinking: boolean;
  max_tokens: number | null;
  prompt_n: number | null;
  cache_n: number | null;
  prompt_ms: number | null;
  predicted_n: number | null;
  predicted_ms: number | null;
  /** From turn start: when this call's request went out, and the first
   * time its own tokens were consumed (null if none ever were). */
  request_sent_ms: number;
  first_delta_ms: number | null;
  /** ENGINE-CONTRACT-02 (home/docs/dev.md 2026-09-23, "U6: the flip
   * verdict" regression A): the engine's own raw, unparsed `arguments`
   * string for the websearch call this generation verified, forced or
   * offered - `null` when no such call was made this generation. Kept
   * beside the parsed call so a parse failure (`args: undefined`) and a
   * literal `{}` are told apart on the record. */
  tool_call_raw_args?: string | null;
  /** ENGINE-CONTRACT-03 (home/docs/dev.md 2026-09-23, "U6 rerun ruling"
   * (a)): true when this generation's own tool call came from the model
   * writing the wire's {name, arguments} shape as plain text instead of
   * through the engine's real tool-call field - kept on the trace so a
   * rerun's own row shows whether a call only landed because of this
   * catch. Absent/false on every generation that made a real wire call
   * or none at all. */
  envelope_parsed?: boolean;
  /** GENFAIL-01 (home/docs/dev.md 2026-09-23, "generation_failed is
   * never blind again"): the real cause when this generation's own
   * stream threw - the engine's status and, where the client captured
   * one, its response body (spec-v0.1.29's own client.ts fix), a
   * timeout, or an abort reason. `null`/absent on a generation that
   * produced a real reply; the failed generation's OWN row still
   * carries every other field it managed to fill in before the throw
   * (`request_sent_ms`, `first_delta_ms`), this is only the reason it
   * stopped there. */
  error?: string | null;
  /** THIN-1E: the Stack's own `offline_reason` when it refused the chat role for this generation. Admin only on the wire. */
  offline_reason?: string | null;
  /** CHAT-CALM-ERRORS-01b: the raw facts of a failed generation, admin
   * only on every channel (turnErrorDetail.ts's statsForViewer strips them
   * with `error` and `offline_reason`): the Stack's own `error`, the HTTP
   * status and role `state` of its reply, its body (redacted, at most 2,000
   * characters), the engine and model that were answering, and when the
   * generation failed (ms after the turn started, and the ISO time). */
  stack_error?: string;
  http_status?: number;
  state?: string;
  raw_body?: string;
  engine_id?: string;
  model_id?: string;
  /** The failure's kind (backend failureCopy.ts's FailureKind) as classified when it happened; admin only. */
  failure_kind?: "busy" | "memory" | "stopped" | "slow" | "unreachable" | "context_too_large" | "other";
  failed_ms?: number;
  failed_at?: string;
}

// THIN-1E and CHAT-CALM-ERRORS-01b: the admin-only detail of a failed turn,
// read from GET /api/turn-error-detail/:id and carried on the stream error
// event (lib/turnErrorDetail.ts builds it; non-admins never receive it).
export interface ToolFailureDetail {
  tool_id: string;
  call_id: string;
  kind: "unavailable" | "timed_out" | "found_nothing" | "errored" | "bad_arguments";
  error_code?: string;
  error_text?: string;
  at?: string;
  duration_ms?: number;
}

export interface GenerationFailureDetail {
  reason: string;
  /** The Stack's own error when it gave one, else the generation's caught message. */
  error: string;
  request_sent_ms: number;
  offline_reason?: string;
  http_status?: number;
  state?: string;
  raw_body?: string;
  engine_id?: string;
  model_id?: string;
  failed_ms?: number;
  failed_at?: string;
}

/** CHAT-CALM-ERRORS-01b (design section 10): the plain cause and the one
 * next step above the raw rows, from failureCopy.ts's closed tables. */
export interface FailureAdviceDetail {
  cause: string;
  next_step: string;
  repairs: boolean;
}

export interface TurnErrorDetail {
  turn_id: string;
  /** False when no row was stored for this turn: a fact to report, never a reading failure. */
  found: boolean;
  advice?: FailureAdviceDetail;
  tools: ToolFailureDetail[];
  generations: GenerationFailureDetail[];
}

/** U2's own per-node trace entry, TurnGeneration's structural twin -
 * see TurnStats.nodes's own doc comment for why this is hand-declared
 * rather than imported. */
export interface TurnNodeExecution {
  node: "safety" | "commands" | "context" | "model" | "policy" | "tool" | "answer" | "output_gate";
  impl: string;
  version: string;
  startMs: number;
  endMs: number;
  // GENFAIL-01: `message` mirrors contract.ts's own NodeOutcome exactly
  // (a code review caught the two drifting - a TS type cast elsewhere
  // in this same path already suppresses excess-property checking, so
  // an undeclared field would ride the wire unchecked instead of
  // failing to compile). The engine's own diagnostic text only (a
  // status, a response body), never a household member's words - see
  // contract.ts's own NodeOutcome doc for the identical note.
  outcome: { ok: true } | { ok: false; code: string; message?: string } | { skipped: true; reason: string };
  /** "Reasoning is a second output" (turn-machine-state-record's owner
   * ruling): set only on the `model` node's own entry, mirroring
   * turnMachine/contract.ts's NodeExecution.reasoning structurally
   * (see this file's own header note on why these two are hand-kept
   * in step rather than imported). */
  reasoning?: { emitted: boolean; withheld_for: "minor" | "surface" | "presence" | "gate" | null };
}

// ADMIN-COMPARE-01: POST /api/turn/bare's own trace and NDJSON event
// shapes, shared here (not kept local to routes/turnBare.ts) so the
// frontend can import them the exact way it already imports every other
// wire type - directly from this file, never a hand-copied mirror.
export interface BareCompareTrace {
  rung: string | null;
  rules: string[];
  routing_tier: string | null;
  routing_score: number | null;
  guard_reason: string | null;
  source: string;
  plugin_id: string | null;
  command_id: string | null;
  stats: TurnStats | null;
  // Re-resolved fresh against the household's CURRENT persona setting,
  // never stored per-turn (persona.ts's own header) - if the persona
  // changed since the original turn ran, this reflects today's, not
  // necessarily what shaped that reply.
  persona_fragments: string;
}

export type BareCompareEvent =
  | { type: "trace"; trace: BareCompareTrace }
  | { type: "reasoning"; text: string }
  | { type: "delta"; text: string }
  | { type: "refused" }
  | { type: "done" };

/** SAFETY-NOTICE-01: crisis resources as a client draws them beside a
 * reply: a supportive title, the text, and the ways to reach the line as
 * links (lib/failureCopy.ts's crisisSupportFor() builds it). */
export interface CrisisSupport {
  title: string;
  text: string;
  actions: Array<{ label: string; href: string }>;
}

export interface TurnValue {
  reply: TurnReply;
  // "confirm" (Session C step 2): a pendingAsk resolved to "no" - the
  // person declined, nothing ran. A "yes" instead runs the pending
  // plugin and reports "plugin"/"plugin_error" as usual.
  /** CHAT-03 adds `policy`: a deterministic line from a content policy
   * (today the one: "Keep passwords and keys in Credentials, not in
   * chat."), neither a package's answer nor the model's words. */
  source: "safety_refuse" | "plugin" | "plugin_error" | "command" | "command_error" | "model" | "confirm" | "policy";
  plugin_id?: string;
  command_id?: string;
  safety: SafetyResult;
  /** 4.3: "offer, never block." Set on allow_with_resources, and (CHAT-02)
   * on a refusal whose categories include self_harm, kept separate from
   * `reply` so a surface can present it alongside the answer rather than
   * have it silently reshape the model's own words. */
  crisis_resources?: string;
  /** SAFETY-NOTICE-01 (additive): the same resources as a client draws
   * them, a supportive title, the text and the call, text and chat links
   * (failureCopy.ts's crisisSupportFor()). Set exactly when crisis_resources is. */
  crisis_support?: CrisisSupport;
  /** Session A step 3 (conversations): every real turn resolves or
   * creates a conversation and mints its own turn id up front
   * (the retired turn engine's prepareTurn(), also step 2's provenance carrier for
   * anything a plugin remembered mid-turn) - both are always real by the
   * time a TurnValue exists, never optional. */
  conversation_id: string;
  turn_id: string;
  /** A per-request model choice the server could not honor and replaced
   * with the role's current model. Omitted when no override was sent. */
  model_status?: { requested: string; selected: string | null; fallback: boolean; message?: string };
  /** CHAT-STREAM: the persisted branch relationship, additive on the
   * completion response. Ephemeral turns may omit these fields because
   * they do not create a conversation row. */
  parent_turn_id?: string | null;
  branch_chosen?: boolean;
  /** CHAT-PARITY-04: a continuation is a new sibling answer, not an edit;
   * the original stopped turn remains immutable and this points back to it. */
  continued_from_turn_id?: string | null;
  /** Session C step 1: only present for `source: "plugin"` - which tier
   * of route()'s decision fired it and its own score (1.0 for
   * "pattern"; the real cosine, or the keyword-overlap fallback score,
   * for "embedding"/"keyword"; for "tool" - Fix E, native tool calling -
   * the SAME Tier 1 ranking score `resolveToolCalls()` looked up for the
   * called candidate, not a measure of the model's own confidence in its
   * choice, which nothing here measures). conversationHistory.ts's
   * routingStats() aggregates this from the logged turn, not from here
   * directly. */
  routing?: { tier: "pattern" | "embedding" | "keyword" | "tool"; score: number };
  /** CHAT-16 part 4 rule 1: lookup sources carried additively on the wire. */
  sources?: Source[];
  /** CHAT-16 K7: the first inline picture result from the household search. */
  media?: Media;
  /** Finding 60 part two: the bounded image set behind `media`, in result order. */
  media_items?: Media[];
  /** UPLOAD-IMG-01: the user's cleaned local images, represented by store ids. */
  images?: ChatImagePart[];
  /** ANSWER-IMG-02: the pictures shown with this answer (additive). */
  answer_images?: AnswerImageSet;
  /** RVW-1: which rung answered (lib/ruleNames.ts's Rung), additive on
   * the wire and on the turn row. */
  rung?: "typed_source" | "search" | "model_knowledge" | "failed" | "none";
  /** A fixed reply was delivered after generation failed; raw details remain
   * available only through the admin-gated turn error detail route. */
  failed_generation?: true;
  /** COMP-01: whether a validated details document is available for this turn. */
  document_available?: boolean;
  /** THIN-3G: this reply offers a new chat that carries this chat's summary
   * forward (POST /api/conversations with carry_from). Written chat only. */
  carry_offer?: boolean;
  /** The generative-UI contract (chat program record, "The chat's wiring
   * table"): a tool's result with structure renders as the shipped
   * Element's own part, never narrated prose and never drawn by Home.
   * Weather and almanac-date are the first two producers
   * (lib/composer.ts's structuredPartForOutcomes()); every kind here
   * matches one Element's own prop shape exactly (spec-sheet today), so
   * the frontend passes this straight through with no reshaping. */
  structured_part?: StructuredPart;
  /** The chat program's artifact-card/canvas-split experience: this
   * turn's artifact tool call minted or updated a version, named by its
   * own id and version number (lib/artifacts.ts's ArtifactValue), the
   * same way `document_available` names a COMP-01 document without
   * carrying its body inline. Written by `lib/composer.ts`'s
   * `artifactForOutcomes()` (ARTIFACT-02), the bundled `write_document`
   * package's own outcome, hooked into the retired turn engine's
   * `logTurnSafely()` beside `structured_part`; a client fetches the
   * full version from GET /api/artifacts/:id. */
  artifact?: { id: string; version: number };
  /** PROJECT-PROGRESS-01: this turn's own `start_project` tool call
   * launched a background project - the id only (composer.ts's
   * `projectForOutcomes()`), never its title/steps/state, which live on
   * the project record itself and reach the client by polling
   * GET /api/projects/:id (the `JobProgress` reserved tool-call part,
   * NextChatPage.tsx), the same "name it, don't inline it" shape
   * `artifact` above already uses for a version a client fetches
   * separately. */
  project?: { id: string };
  /** APPROVE-CARD-01: set only on the turn that just parked a
   * `confirm_needed`/`consent_needed` ask (turnNext.ts's `finishTurn()`
   * "asked" branch, never for a temporary conversation - `setPendingAsk`
   * is a no-op there, so a card promising a resumable confirm would lie).
   * `package_id` names the parked tool (`PendingAsk.packageId`).
   * `open` is true by construction on this live TurnValue (finishTurn()
   * just parked it, so it's correct at that instant) - but on a RELOADED
   * history row (`ConversationTurnWithMemoryIds.confirm`, below) it is
   * never trusted from what was stored at write time: a coordinator
   * review (2026-09-27) caught the first cut baking `open: true` into
   * the persisted row permanently, so a reload kept showing an answered
   * ask's card as still awaiting an answer forever, because nothing
   * ever rewrites a PRIOR row when the ask resolves. Fixed by deriving
   * `open` at READ time instead (conversationHistory.ts's
   * `listConversationTurns()`/`list()`): true only for the turn whose
   * own id matches the conversation's CURRENT `pending_ask.turnId`,
   * false for every other row that ever carried a confirm (answered,
   * superseded, or from before this ask existed). The frontend pairs
   * this with the tool-call part's own `turn_id` to match a button tap
   * back to the right ask (chatToolCallPart.ts). */
  confirm?: { package_id: string; open: boolean };
  /** STATS-01: optional adult-only engine telemetry, never required. */
  stats?: TurnStats;
  /** ADMIN-COMPARE-01 (b): true when this turn ran the bare-mode bypass
   * (no persona, no routing, no packages - the minor safety pass always
   * runs regardless). Additive and unset on every turn before this;
   * `conversation_turns.bare` is the same signal on a reloaded history
   * row, so a caller need not distinguish a live turn from a reload. */
  bare?: boolean;
  /** REASONING-02: the reasoning that led to a tool call, on a turn
   * that resolved to one (peekAndHandle()'s streaming path, runTurn()'s
   * blocking twin) - the same tag-stripped string a live `reasoning`
   * wire event would have carried, populated from the buffered prefix
   * peeked before the tool call because a tool-calling reply never
   * streams a visible span for gateOutputSafety()/gateGuards() to see,
   * so nothing else on the pipeline ever captures it (a REASONING-01
   * review finding: this was previously lost entirely, not just hidden
   * from the wire). Absent for a prose (model-sourced) reply, whose
   * think block already rides in `reply.text` and reaches the wire via
   * the `reasoning` stream event instead. Stored on the turn row;
   * dropped from this field on the wire for a minor's turn, the same
   * gate the `reasoning` stream event already uses. */
  reasoning?: string;
}

export interface ChatImagePart {
  id: string; name: string; width: number; height: number; media_type: string;
  /** VISION-02c, set by the hub only (never taken from a client): the
   * picture went to the chat model as a picture part on its turn, so a
   * later window names it as shown then, not as never seen. */
  shown_to_model?: true;
}
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_REFUSAL = "You can add up to 4 pictures, each up to 10 MB.";

export type ConversationTurnRow = typeof conversationTurns.$inferSelect;

export type ConversationRow = typeof conversations.$inferSelect;

/** GET /api/conversations' listing shape (step 3's contract): the
 * thread's own metadata plus two values derived by joining
 * conversation_turns, not stored on the row itself. */
export interface ConversationSummary {
  id: string;
  surface: string;
  companion_id: string | null;
  title: string | null;
  pinned: boolean;
  /** CONV-ARCHIVE-01: shelved chats leave the default list. */
  archived: boolean;
  /** PROJECTS-01a: the project (chat folder) this chat sits in, or null. */
  folder_id: string | null;
  /** PROJECTS-UI-02a: read-time preview of the latest user turn. Null when
   * this viewer is not the conversation's person or no safe turn exists. */
  preview?: string | null;
  turn_count: number;
  last_turn_at: string | null;
  created_at: string;
}

/** GET /api/conversations/:id/turns' per-turn shape (step 3's contract):
 * the turn plus which memory records trace their provenance to it -
 * empty until the judge (step 6) or an in-turn `remember` writes one. */
export interface Media { kind: "image"; url: string; thumbnail: string | null; source: string; source_url?: string }
// REASONING-02: `reasoning` is Omitted and redeclared optional here, the
// same as `stats` - the read side (conversationHistory.ts's
// listConversationTurns()/list()) drops the raw column entirely for a
// minor's own turn rather than sending `null`, matching the write-side
// gate `reasoning`'s own wire event and POST /api/turn already apply.
export type ConversationTurnWithMemoryIds = Omit<ConversationTurnRow, "sources" | "media" | "stats" | "reasoning" | "structuredPart" | "confirm" | "images" | "answerImages"> & { sources?: Source[]; media?: TurnValue["media"]; media_items?: Media[]; images?: ChatImagePart[]; answer_images?: AnswerImageSet; stats?: TurnStats; reasoning?: string; memory_ids: string[]; crisis_support?: CrisisSupport; artifact?: { id: string; version: number }; project?: { id: string }; structured_part?: StructuredPart; confirm?: { package_id: string; open: boolean } };

// POST /api/turn/stream's real wire shape (2026-09-04): newline-delimited
// JSON, one event per line (the same shape the legacy hub's own
// POST /api/tts/stream used - docs/dev.md's tts-role entry). A "delta"
// event's `text` is the next slice of the reply (the whole thing in one
// event for a safety-refusal or plugin reply, since neither has anything
// to gain from trickling in); exactly one "done" event ends the stream,
// carrying the same TurnValue shape POST /api/turn already returns so a
// client needs only one code path to read the final result either way.
//
// "spoken_cue" (2026-09-05, home-legacy.git's own researched pattern -
// docs/internal/voice-naturalness.md, companionTurn.ts's toolAckCue):
// fires at most once, only when the `chat` model's own time to first
// token is genuinely slow enough that silence would read as dead air -
// never a task announcement, never stored anywhere. It is NOT part of
// `reply` at all and MUST NOT be folded into the displayed message text,
// spoken alongside it, or written to conversation history: the whole
// reason it exists is that a person says "let me check" only when
// checking actually takes a moment, and a small model that saw its own
// cue in its history would start opening every reply with it.
export type TurnStreamEvent =
  | { type: "turn_meta"; conversation_id: string; turn_id: string; resume_token?: string }
  /** WIRE-01: immediately after turn_meta, before any status, spoken_cue or delta, on every turn, immediate ones included. */
  | { type: "signal"; signal: TurnSignal }
  | { type: "delta"; text: string; sequence?: number }
  /** REASONING-01 (docs/plans/shell-on-shadcndashboard-2026-09-21.md's
   * own wire table): the model's own think-block content, split out of
   * `delta` at the wire boundary (routes/turn.ts's streamTurnEvents(),
   * lib/wellFormed.ts's feedThinkSplit()) as it arrives - assistant-ui's
   * `reasoning` Element's own part shape. Never emitted for a minor's
   * turn (child or teen, ageBand.ts's shared band - docs/dev.md's own
   * call: a minor sees the answer, not the model's thinking) - dropped
   * at that same boundary, not redacted. */
  | { type: "reasoning"; text: string; sequence?: number }
  /** CHAT-16: frontend chatTurnActivity.ts transient activity contract. */
  | { type: "status"; text: string; stage: "lookup" | "thinking" | "tool" | "composing" }
  | { type: "spoken_cue"; text: string }
  | { type: "done"; value: TurnValue }
  /** ANSWER-IMG-02 (rule 9, additive): at most once per turn, at a paragraph
   * boundary of the released text, never above text already sent. */
  | ({ type: "images"; turn_id: string } & AnswerImageSet)
  // `code` (step 9, session-a-intelligence.md: "emit error with the
  // catalogue code") is optional and additive: a spec/errors/errors.json
  // code when the failure maps to one (today, only the output-side
  // safety cut sets it, "safety_refused"), omitted for the generic
  // mid-stream engine failure that already used this event before this
  // step - existing clients reading only `error` see no change.
  // SAFETY-01 (#85): a streamed safety refusal carries its crisis
  // resources here, since this is the one terminal event it sends
  // (additive; a client reading only `error` sees no change).
  // CHAT-CALM-ERRORS-01b (rule 9, additive): `detail` is the failed
  // turn's admin details, sent to an adult owner or admin only
  // (turnErrorDetail.ts's streamEventForViewer); every other client may
  // ignore it.
  | { type: "error"; error: string; code?: string; crisis_resources?: string; crisis_support?: CrisisSupport; detail?: TurnErrorDetail };

export interface ResolvedSetting {
  key: string;
  value: unknown;
  source: "user" | "default" | "package" | "sync";
  label: string;
  help?: string;
  level: "basic" | "advanced" | "expert";
  secret: boolean;
  /** Only meaningful when secret is true: whether a real value has been
   * stored, without ever revealing it (lib/settings.ts's resolveForResponse). */
  isSet?: boolean;
  does?: string;
  state?: string;
  reason?: string;
}

export interface BackupInfo {
  filename: string;
  createdAt: string;
  bytes: number;
}

// Mirrors lib/clonedVoices.ts's ClonedVoiceInfo (hand-copied, same reason
// as BackupInfo above: that file has "@/"-aliased imports of its own).
// `creatorName` is a display convenience joined in by the lib, not a raw
// DB column - the UI shows "uploaded by Sage", never a bare person id.
export interface ClonedVoiceInfo {
  id: string;
  label: string;
  creatorId: string;
  creatorName: string;
  bytes: number;
  createdAt: string;
}

// Inlined rather than re-exported from lib/modelCatalog.ts (which uses
// "@/"-aliased imports internally, unlike lib/hardware.ts above): the
// same reason BackupInfo is a hand-copy of backup.ts's shape.
export interface ModelFit {
  model: ModelCapabilities;
  fits: boolean;
  contextUsed?: number;
  requiredBytes: number;
  budgetBytes: number;
}

/** The small, non-diagnostic model shape used by Chat's parent-facing
 * picker. Hardware fit and engine details stay on the owner settings route. */
export interface ChatModelOption {
  id: string;
  label: string;
}

/** VISION-02c: what the signed-in person's chat can do right now, one
 * source for the composer. `image_parts`: the running chat model reads
 * pictures (the Stack's chat row) and this person's pictures go to it;
 * false keeps today's behaviour (the picture is kept, the model told it
 * cannot see it). Derived on the backend only; the frontend never
 * decides it from a model id (rule 8). */
export interface ChatCapabilities {
  image_parts: boolean;
  /** VISION-02d: whether the chat model this person's turn runs on can
   * think before it answers, from its record (rule 8): "switchable" shows
   * the Instant/Thinking control, "none" and "always" show none (there is
   * nothing to switch). A minor's turn never thinks, so it reads "none". */
  thinking: "switchable" | "none" | "always";
  /** The same, per chat model the Stack can start (the model picker). */
  thinking_modes: Record<string, "switchable" | "none" | "always">;
}

export interface ChatModelsResponse {
  models: ChatModelOption[];
  selectedModel: (ChatModelOption & { available: boolean }) | null;
  canSelect: boolean;
}

// Mirrors modelDownloadJobs.ts's JobRow (hand-copied, same reason as
// ModelFit/BackupInfo above: that file's own imports aren't
// alias-free).
export type ModelJobStatus =
  | "queued"
  | "downloading_engine"
  | "downloading_model"
  | "verifying"
  | "loading"
  | "testing"
  | "ready"
  | "failed"
  | "none";

export interface ModelJob {
  modelId: string;
  status: ModelJobStatus;
  phase: string;
  completedBytes: number;
  totalBytes: number;
  error: string | null;
  postLoadCheck: { estimatedBytes: number; actualBytes: number | null; driftPct: number | null } | null;
  createdAt?: string;
  updatedAt?: string;
}

// Mirrors llmSupervisor.ts's EngineStatus/BackendKind and
// engineStats.ts's EngineStatsSample (hand-copied, same reason as
// ModelFit/BackupInfo above).
export type EngineKind = "url" | "override" | "selection" | "stub" | "stopped" | "starting" | "stalled" | "none";

/** The three kinds an engine's Repairs-page auto-heal can add on top of
 * a supervisor's own EngineKind - "spawned" is the local speech supervisor's/
 * predates them). Declared once here (2026-09-07) so app.ts's schema,
 * sidecars.ts's engineHealthKind(), and HealthSection.tsx's badge all
 * draw from the same three literals instead of hand-repeating them. */
/** "blocked" (ENGINE-PORT-01, dev.md 2026-09-23): a live process this
 * install never spawned already holds the role's own port, so the
 * spawn was refused rather than killing it - distinct from "failed"
 * (this install's own spawn attempts gave up) because the fix is never
 * a retry, only dealing with whatever else is on that port. */
export type EngineHealthKind = EngineKind | "spawned" | "restarting" | "failed" | "blocked";

export interface EngineStatus {
  kind: EngineKind;
  modelId: string | null;
  pid: number | null;
  startedAt: string | null;
}

export interface EngineStatsSample {
  at: string;
  memoryBytes: number | null;
  cpuPercent: number | null;
}

// Mirrors app.ts's GET /api/health response shape (hand-copied, same
// reason as EngineStatus/EngineStatsSample above: app.ts pulls in "@/"-
// aliased imports of its own).
export type SidecarStatus = "stopped" | "starting" | "running" | "unhealthy" | "crashed";

export interface SidecarStatusEntry {
  id: string;
  status: SidecarStatus;
  baseUrl: string | null;
}

export interface EngineHealthEntry {
  kind: EngineHealthKind;
  pid: number | null;
  /** A real probe of the process: true/false when something is supposed
   * to be up, null when there is nothing to probe yet. */
  alive: boolean | null;
  availability?: "ready" | "starting" | "unavailable";
  reason?: "stopped" | "crashed" | "blocked_port" | "not_installed" | "failed_start" | null;
  /** THIN-1C (fixes part of getmaipai/home#203): present only when the
   * Stack itself refused this role (an HTTP 503 with its `offline_reason`,
   * e.g. the machine is low on memory): that reason in the household's
   * wording, the same line the chat reply carries. The status page shows
   * it beside the engine's row; absent, the row reads as before. */
  detail?: string | null;
  /** Live Stack context split across parallel chat slots. */
  context_length?: number | null;
  context_slots?: number | null;
  context_per_slot?: number | null;
  context_scope?: "total" | "per_slot" | null;
  context_message?: string | null;
  /** CHAT-CALM-ERRORS-01d: the composer line for each band while chat
   * cannot answer (failureCopy.ts's composerNotice); absent or null when
   * the engine is ready. Additive: clients that ignore it lose nothing. */
  notice?: ComposerNotice | null;
}

/** Mirrors lib/failureCopy.ts's ComposerNotice (that file stays import-free). */
export interface ComposerNotice {
  adult: string;
  teen: string;
  child: string;
  repairs_link: string | null;
}

export interface HealthStatus {
  brain: string;
  voice: string;
  /** False when any engine that should be up is not answering, or a
   * sidecar is unhealthy/crashed. */
  ok: boolean;
  engines: { chat: EngineHealthEntry; embed: EngineHealthEntry; background: EngineHealthEntry; voice: EngineHealthEntry };
  uptimeSeconds: number;
  sidecars: SidecarStatusEntry[];
}

// Mirrors lib/conversationHistory.ts's RoutingStats (hand-copied, same
// reason as BackupInfo/ModelFit above: that file has "@/"-aliased
// imports of its own).
export interface RoutingStats {
  total: number;
  plugin: number;
  pluginError: number;
  command: number;
  commandError: number;
  model: number;
  safetyRefuse: number;
  fallthroughRate: number | null;
  // Session C step 1: additive per-entry fields, kept alongside the
  // existing `pluginId`/`count` RoutingStatsSection.tsx (Session E's
  // file, not touched here) already reads - `tier` is a count breakdown
  // ("pattern"/"embedding"/"keyword" fires for this plugin), `avgScore`
  // its mean routing_score, both null-safe for a turn logged before this
  // step (routing_tier/routing_score are nullable columns, backfilled by
  // nothing - old rows just don't contribute to either field).
  byPlugin: { pluginId: string; count: number; tier: { pattern: number; embedding: number; keyword: number }; avgScore: number | null }[];
  byCommand: { commandId: string; count: number }[];
}

// The role-string half of lib/access.ts's isOwnerOrAdmin(actor: PersonRow):
// that function takes a full PersonRow (an "@/types" dependency this file
// can't have), so this is the underlying string check, shared for real
// with a frontend client instead of being hand-copied a third time. A
// code review (2026-09-04) found frontend/src/apps/settings/SettingsPage.tsx
// had grown its own inline `role === "owner" || role === "admin"` on top
// of frontend/src/apps/people/roles.ts's requiresSecret doing the
// identical check for an unrelated reason - both now call this.
export function isOwnerOrAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

// TEMP-CHAT-01: the same role floor conversationHistory.ts's
// createConversation() already checked for mode: "temporary" (Chat 55,
// 2026-09-16) - factored out here, alongside isOwnerOrAdminRole, once a
// second call site (the new zero-footprint construction path) needed the
// identical check rather than a hand-copied second version of it.
export function canHaveTemporaryChatRole(role: string): boolean {
  return isOwnerOrAdminRole(role) || role === "adult";
}

/** One row of the "what leaves the house" table
 * (getmaipai/.github/CLAUDE.md > Privacy architecture: "every product
 * keeps a user-tier privacy page with the what-leaves-the-house table:
 * each outbound connection, when it happens, what it carries, and who
 * receives it").
 *
 * The four PrivacyRow fields from `@maipai/standards` (destination,
 * when, what, who) plus opt_in and retention, flattened with the name of
 * whatever declares the connection. A package manifest's `data_sources[]`
 * entries are already exactly PrivacyRow; `source` is what lets one
 * table hold those alongside the hub's own connections without the page
 * having to know the difference. */
export interface PrivacyConnection {
  /** Unique across the whole table: "<source id>:<row id>". */
  id: string;
  /** Who in the product opens this connection: a plugin's display name,
   * or the hub itself. */
  source: string;
  sourceKind: "platform" | "plugin";
  destination: string;
  when: string;
  what: string;
  who: string;
  /** False only for connections the hub makes on its own without anyone
   * turning anything on. Every one of those is still a download the
   * family started; nothing here is a background phone-home. */
  optIn: boolean;
  retention: string;
  /** Issue #12: which way this row runs. Every row is "outbound" (the
   * house reaching a third party) except lib/privacy.ts's own
   * inboundConnections() - a real, structural distinction ("can
   * something reach INTO my house" is a different question from "does
   * something leave it"), not something PrivacyPage.tsx should have to
   * infer from an id string. */
  direction: "outbound" | "inbound";
}

/** A restore that is staged and waiting for the hub's next restart
 * (lib/restoreStaging.ts). */
export interface PendingRestore {
  filename: string;
  stagedAt: string;
  stagedByPersonId: string;
}

// Mirrors lib/commands.ts's CommandRow/CommandAction (hand-copied, same
// reason as BackupInfo/ModelFit/RoutingStats above: that file has
// "@/"-aliased imports of its own, and pulls in a Zod schema besides -
// this is the plain wire shape a frontend client actually needs).
export type CommandAction =
  | { kind: "reply"; text: string; speech?: string }
  | {
      kind: "home_call_service";
      domain: string;
      service: string;
      target: Record<string, unknown>;
      data?: Record<string, unknown>;
    };

export interface CommandRow {
  id: string;
  creatorId: string;
  trigger: string;
  minRole: string;
  action: CommandAction;
  createdAt: string;
}

// Mirrors lib/notifications.ts's NotificationDeliveryView (hand-copied,
// same reason as CommandRow/RoutingStats above).
export interface NotificationDeliveryView {
  id: string;
  typeId: string;
  level: "immediate" | "time_sensitive" | "passive";
  text: string;
  channels: ("in_app" | "telegram" | "robot")[];
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  subjectTurnId: string | null;
  memoryIds: string[] | null;
  toast: boolean;
}

// GET /api/dashboard (SHELL-01): mirrors lib/dashboard.ts's own Dashboard/
// DashboardActivityRow/DashboardTurnsPerDay/DashboardEngineCounts (hand-
// copied here, same reason as every other type on this file - lib/
// dashboard.ts imports "@/..."-aliased modules frontend's tsconfig can't
// resolve, so this alias-free file is the one both sides import from;
// lib/dashboard.ts re-exports these rather than redefining them).
export interface DashboardActivityRow {
  turn_id: string;
  person_id: string;
  display_name: string;
  created_at: string;
  surface: string;
  source: string;
}

export interface DashboardTurnsPerDay {
  date: string;
  count: number;
}

export interface DashboardEngineCounts {
  critical: number;
  error: number;
  warning: number;
  total: number;
}

export interface Dashboard {
  people_count: number;
  updates_available: boolean;
  recent_activity: DashboardActivityRow[];
  turns_per_day: DashboardTurnsPerDay[];
  /** Owner/admin only - absent (not null, not zero) for anyone else. */
  repairs_open?: number;
  /** Owner/admin only. `null` means owner/admin, but no Stack is
   * configured for this household (the common case today) - distinct
   * from the field being absent for a non-admin viewer. */
  engines?: DashboardEngineCounts | null;
}

// GET /api/engines and GET /api/engines/health (SHELL-06, HOME-STACK-04a):
// hand-copied from routes/engines.ts's own zod schemas (RoleInfoSchema,
// EngineInfoSchema, BudgetSchema, HealthItemSchema) for the same reason
// as every other type on this file - the frontend can't resolve that
// route file's own "@/..." imports. routes/engines.ts stays the single
// source of truth for validation and OpenAPI; these are a plain-TS
// mirror of its response shape, not re-exported back into it (unlike
// Dashboard above, nothing on the backend needs these as its own return
// type - the zod schemas already give the route file its own safety).
export type StackRoleId = "chat" | "coding" | "judge" | "router" | "embed" | "rerank" | "vision" | "stt" | "tts" | "wakeword" | "image" | "video" | "music";

export interface StackRoleInfo {
  id: StackRoleId;
  label: string;
  wire: "chat" | "embeddings" | "rerank" | "transcription" | "speech" | "job";
  residency: "resident" | "jit" | "installed";
  endpoints: string[];
  quality: ("fast" | "everyday" | "best")[];
  sharesModelWith: StackRoleId | null;
  state: { state: "notInstalled" | "installed" | "loaded" | "ready" | "offline"; since: string; checkedAt?: string; reason?: string | null };
  reason: string | null;
  model: { id: string; sizeBytes: number | null; measuredFootprintBytes: number | null; measuredContextLength: number | null; estimated: boolean } | null;
  check: { state: "not checked" | "passed" | "failed" | "skipped"; at: string | null; reason: string | null; stale: boolean };
  /** The chat role's verified models compatible with the installed engine. */
  models?: Array<{ id: string; name: string }>;
}

export interface StackEngineInfo {
  id: string;
  name: string;
  label: string;
  platform: string;
  arch: string;
  verified: boolean;
  installed: boolean;
  matchesThisMachine: boolean;
  running: string | null;
  currentTag: string | null;
  newestTag: string | null;
  current: boolean;
  notCurrent: boolean;
  needsRestart: boolean;
  state: "current" | "notCurrent";
  stateReason: "newer installed" | "newer available" | null;
  directory: string;
  roleState: string;
  roleReason: string | null;
}

export interface StackBudget {
  totalMemoryBytes: number;
  capBytes: number;
  freeMemoryBytes: number;
  availablePercent: number;
  pressure: "normal" | "warn" | "critical";
  memoryReadingDegraded: boolean;
  loaded: Array<{ id: string; kind: "resident" | "jit" | "generator"; peakBytes: number; measured: boolean; lastUsedAt: string; idleTtlSeconds: number; pinned: boolean; pid: number | null }>;
  queue: Array<{ id: string; position: number; kind: "resident" | "jit" | "generator" }>;
}

export interface StackHealthItem {
  code: string;
  severity: "critical" | "error" | "warning";
  title: string;
  text: string;
  since: string;
  cause: string;
  fix?: { label: string; action: "restart_engine" | "free_memory" | "retry_download" | "rollback_update" | "reinstall_engine" | "reinstall_model" };
}

export interface EnginesOverview {
  /** false when no Stack is configured for this household (the common
   * case today) - roles/engines are empty and budget is null, never an
   * error, the same posture Dashboard's own `engines` field takes. */
  configured: boolean;
  roles: StackRoleInfo[];
  engines: StackEngineInfo[];
  budget: StackBudget | null;
}

export interface EnginesHealth {
  configured: boolean;
  health: StackHealthItem[];
}

// GET /api/performance (ADMIN-PERF-01): hand-copied from routes/
// performance.ts's own zod schemas, same reason as every other type on
// this file. No new collection - every field here is an aggregation of
// what conversation_turns, the Repairs issues table, the memory/
// embedding queues, the label harvest and the Stack already record.
export interface PerformanceTurnDayStats {
  date: string;
  count: number;
  median_ttft_ms: number | null;
  p95_ttft_ms: number | null;
  median_total_ms: number | null;
  p95_total_ms: number | null;
  median_tokens_per_second: number | null;
}

export interface PerformanceEngineStats {
  /** The turn's stored `stats.engine` string (host, build, model file
   * joined - engineIdentity.ts's own formatEngineIdentity()), the
   * closest thing to "per model" that actually exists on a turn: no
   * column carries a parsed-out model id on its own. */
  engine: string;
  count: number;
  median_ttft_ms: number | null;
  p95_ttft_ms: number | null;
  median_total_ms: number | null;
  p95_total_ms: number | null;
  median_tokens_per_second: number | null;
}

export interface PerformanceTurns {
  window_days: number;
  by_day: PerformanceTurnDayStats[];
  by_engine: PerformanceEngineStats[];
  /** Count of turns whose stored route (source: model | plugin | command
   * | safety_refuse | ...) matches each value, over the whole window. */
  by_route: Array<{ route: string; count: number }>;
}

export interface PerformanceQueues {
  judge: { pending: number; oldest_created_at: string | null };
  embedding: { pending: number };
  ingestion: { pending: number; by_reason: Array<{ reason: string; count: number }> };
}

export interface PerformanceLabels {
  window_days: number;
  turns: number;
  guard_hits: Array<{ key: string; count: number }>;
  rule_hits: Array<{ key: string; count: number }>;
  rungs: Array<{ key: string; count: number }>;
  retire_eligible: string[];
}

/** U2's per-node trace, aggregated (ADMIN-LAYERS-01's future full panel
 * builds on this same field - the coordinator's 2026-09-22 addition to
 * this item). `turns_with_trace` is 0, and `nodes` is empty, on any hub
 * where no turn has produced a trace yet - the honest
 * empty state, not an error. */
export interface PerformanceLayerStats {
  node: string;
  count: number;
  median_ms: number | null;
  p95_ms: number | null;
}

export interface PerformanceLayers {
  window_days: number;
  turns_with_trace: number;
  nodes: PerformanceLayerStats[];
}

export interface PerformanceEngines {
  configured: boolean;
  roles: StackRoleInfo[];
  engines: StackEngineInfo[];
  budget: StackBudget | null;
  /** Repairs issues whose source names an engine (engine.* health/
   * restart events synced from the Stack) - there is no separate
   * restart-history table, so this is the closest real "history" a
   * turn's own read can show. */
  recent_issues: Array<{ source: string; key: string; severity: string; createdAt: string; resolvedAt: string | null }>;
}

export interface PerformanceHardware {
  configured: boolean;
  /** Passthrough - the Stack has not spec'd this shape upstream
   * (routes/engines.ts's own HardwareSchema takes the same posture). */
  hardware: Record<string, unknown> | null;
}

export interface PerformanceDisk {
  total_bytes: number;
  free_bytes: number;
  areas: Array<{ area: string; bytes: number }>;
}

/** STORE-PAGE-01: one row on the Storage settings page's data table -
 * lib/storage/usage.ts's storageUsageOverview() builds these from the
 * same personUsageBytes()/personCapBytes()/personUsageByKind() the
 * record API's own cap enforcement reads (STORE-CAP-01), never a second
 * computation for the page. */
export interface PersonStorageRow {
  personId: string;
  displayName: string;
  role: string;
  usageBytes: number;
  capBytes: number;
  byKind: Array<{ kind: FileRecord["kind"]; bytes: number }>;
}

/** `household` is null for anyone who isn't owner/admin (the acceptance's
 * "a child sees only their own row": no household total, no other
 * person's row - enforced inside storageUsageOverview() itself, not a
 * second filter here or on the frontend). */
export interface StorageUsageOverview {
  people: PersonStorageRow[];
  /** `inherited` (STORE-DELETE-01): files shared by people no longer
   * here, now the household's; already part of `usageBytes`. */
  household: { usageBytes: number; capBytes: number; inherited: { files: number; bytes: number } } | null;
}

export interface Performance {
  turns: PerformanceTurns;
  queues: PerformanceQueues;
  labels: PerformanceLabels;
  layers: PerformanceLayers;
  engines: PerformanceEngines;
  hardware: PerformanceHardware;
  disk: PerformanceDisk;
  /** Documents conversation.retention's existing daily purge
   * (conversationHistory.ts's runRetention(), household.conversation_
   * retention_days, default 90) - not a second purge path for this
   * data, a stated fact about the one that already deletes it. */
  retention_days: number;
}

/** Status apps GET wire contract, shared by the OpenAPI route and frontend. */
export type StatusAppNeedWire = { kind: "engine" | "service" | "internet"; id: string; name: string; purpose: string; required: boolean; state: "operational" | "degraded" | "down" | "waiting" | "unknown"; last_success_at?: string | null; last_error_class?: string | null };
export type StatusAppWire = { id: string; name: string; state: "operational" | "degraded" | "down" | "waiting_for_internet"; reason: string | null; paused?: boolean; needs?: StatusAppNeedWire[]; history: Array<{ date: string; state: "operational" | "degraded" | "down" | "waiting_for_internet"; uptime: number; minutes: { operational: number; degraded: number; outage: number; maintenance: number } }>; uptimePercent: number };
export type StatusAppsWire = StatusAppWire[];
