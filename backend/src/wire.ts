import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
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

export interface TurnReply {
  text: string;
  speech?: string;
}

export interface TurnValue {
  reply: TurnReply;
  // "confirm" (Session C step 2): a pendingAsk resolved to "no" - the
  // person declined, nothing ran. A "yes" instead runs the pending
  // plugin and reports "plugin"/"plugin_error" as usual.
  source: "safety_refuse" | "plugin" | "plugin_error" | "command" | "command_error" | "model" | "confirm";
  plugin_id?: string;
  command_id?: string;
  safety: SafetyResult;
  /** 4.3: "offer, never block." Set only on allow_with_resources, kept
   * separate from `reply` so a surface can present it alongside the
   * answer rather than have it silently reshape the model's own words. */
  crisis_resources?: string;
  /** Session A step 3 (conversations): every real turn resolves or
   * creates a conversation and mints its own turn id up front
   * (turnEngine.ts's prepareTurn(), also step 2's provenance carrier for
   * anything a plugin remembered mid-turn) - both are always real by the
   * time a TurnValue exists, never optional. */
  conversation_id: string;
  turn_id: string;
  /** Session C step 1: only present for `source: "plugin"` - which tier
   * of route()'s decision fired it and its own score (1.0 for
   * "pattern"; the real cosine, or the keyword-overlap fallback score,
   * for "embedding"/"keyword"). conversationHistory.ts's routingStats()
   * aggregates this from the logged turn, not from here directly. */
  routing?: { tier: "pattern" | "embedding" | "keyword"; score: number };
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
  turn_count: number;
  last_turn_at: string | null;
  created_at: string;
}

/** GET /api/conversations/:id/turns' per-turn shape (step 3's contract):
 * the turn plus which memory records trace their provenance to it -
 * empty until the judge (step 6) or an in-turn `remember` writes one. */
export type ConversationTurnWithMemoryIds = ConversationTurnRow & { memory_ids: string[] };

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
  | { type: "turn_meta"; conversation_id: string; turn_id: string }
  | { type: "delta"; text: string }
  | { type: "spoken_cue"; text: string }
  | { type: "done"; value: TurnValue }
  // `code` (step 9, session-a-intelligence.md: "emit error with the
  // catalogue code") is optional and additive: a spec/errors/errors.json
  // code when the failure maps to one (today, only the output-side
  // safety cut sets it, "safety_refused"), omitted for the generic
  // mid-stream engine failure that already used this event before this
  // step - existing clients reading only `error` see no change.
  | { type: "error"; error: string; code?: string };

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
  engines: { chat: EngineHealthEntry; embed: EngineHealthEntry; voice: EngineHealthEntry };
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
}
