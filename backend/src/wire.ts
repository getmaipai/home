import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { conversationTurns, conversations } from "./db/schema";
// hardware.ts has zero "@/"-aliased imports of its own, unlike backup.ts
// and modelCatalog.ts below, so its types are re-exported directly
// instead of hand-copied a second time.
export type { HardwareInfo, CudaDevice } from "./lib/hardware";

// The wire shapes a browser client needs, kept alias-free (relative
// imports only, never "@/...") so frontend/src/lib/api.ts can import this
// file directly through the @maipai/home-backend workspace dependency:
// backend's own tsconfig "@/*" path mapping does not apply when frontend's
// tsc resolves a file pulled in from another package (a code review,
// 2026-09-04, caught this exact mirror-can-drift risk when these three
// shapes were still hand-duplicated in api.ts; the first fix attempt
// re-exported the real files directly and failed to typecheck for
// exactly this reason). turnEngine.ts, conversationHistory.ts, and
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
export type Roster = Omit<Person, "birthdate"> & { hasSecret: boolean; hasPasskeys?: boolean };

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

export interface TurnStats {
  prompt_tokens: number | null;
  predicted_tokens: number | null;
  tokens_per_second: number | null;
  time_to_first_token_ms: number | null;
  total_time_ms: number | null;
  context_tokens: number | null;
  context_used_percent: number | null;
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
   * for "didn't run") on every row the old path (turnEngine.ts) still
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
 * see turnEngine.ts's GenerationRecord for the working shape this comes
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
  outcome: { ok: true } | { ok: false; code: string } | { skipped: true; reason: string };
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
  /** Session A step 3 (conversations): every real turn resolves or
   * creates a conversation and mints its own turn id up front
   * (turnEngine.ts's prepareTurn(), also step 2's provenance carrier for
   * anything a plugin remembered mid-turn) - both are always real by the
   * time a TurnValue exists, never optional. */
  conversation_id: string;
  turn_id: string;
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
  /** RVW-1: which rung answered (lib/ruleNames.ts's Rung), additive on
   * the wire and on the turn row. */
  rung?: "typed_source" | "search" | "model_knowledge" | "failed" | "none";
  /** COMP-01: whether a validated details document is available for this turn. */
  document_available?: boolean;
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
   * package's own outcome, hooked into `turnEngine.ts`'s
   * `logTurnSafely()` beside `structured_part`; a client fetches the
   * full version from GET /api/artifacts/:id. */
  artifact?: { id: string; version: number };
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
export type ConversationTurnWithMemoryIds = Omit<ConversationTurnRow, "sources" | "media" | "stats" | "reasoning"> & { sources?: Source[]; media?: TurnValue["media"]; media_items?: Media[]; stats?: TurnStats; reasoning?: string; memory_ids: string[]; artifact?: { id: string; version: number } };

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
  // `code` (step 9, session-a-intelligence.md: "emit error with the
  // catalogue code") is optional and additive: a spec/errors/errors.json
  // code when the failure maps to one (today, only the output-side
  // safety cut sets it, "safety_refused"), omitted for the generic
  // mid-stream engine failure that already used this event before this
  // step - existing clients reading only `error` see no change.
  // SAFETY-01 (#85): a streamed safety refusal carries its crisis
  // resources here, since this is the one terminal event it sends
  // (additive; a client reading only `error` sees no change).
  | { type: "error"; error: string; code?: string; crisis_resources?: string };

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
export type EngineKind = "url" | "override" | "selection" | "stub" | "stopped" | "starting" | "none";

/** The three kinds an engine's Repairs-page auto-heal can add on top of
 * a supervisor's own EngineKind - "spawned" is ttsSupervisor.ts's/
 * embedSupervisor.ts's own literal, not in EngineKind above (that union
 * predates them). Declared once here (2026-09-07) so app.ts's schema,
 * sidecars.ts's engineHealthKind(), and HealthSection.tsx's badge all
 * draw from the same three literals instead of hand-repeating them. */
export type EngineHealthKind = EngineKind | "spawned" | "restarting" | "failed";

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
  text: string;
  channels: ("in_app" | "telegram")[];
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
 * where `turn.pipeline.next` has never produced a row yet - the honest
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
