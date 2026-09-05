import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { ModelCapabilities } from "@maipai/spec/gen/ts/model-capabilities.js";
import type { conversationTurns } from "./db/schema";
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

export type Roster = Omit<Person, "birthdate"> & { hasSecret: boolean };

export interface TurnReply {
  text: string;
  speech?: string;
}

export interface TurnValue {
  reply: TurnReply;
  source: "safety_refuse" | "plugin" | "plugin_error" | "model";
  plugin_id?: string;
  safety: SafetyResult;
  /** 4.3: "offer, never block." Set only on allow_with_resources, kept
   * separate from `reply` so a surface can present it alongside the
   * answer rather than have it silently reshape the model's own words. */
  crisis_resources?: string;
}

export type ConversationTurnRow = typeof conversationTurns.$inferSelect;

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
  | { type: "delta"; text: string }
  | { type: "spoken_cue"; text: string }
  | { type: "done"; value: TurnValue }
  | { type: "error"; error: string };

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

// Mirrors lib/conversationHistory.ts's RoutingStats (hand-copied, same
// reason as BackupInfo/ModelFit above: that file has "@/"-aliased
// imports of its own).
export interface RoutingStats {
  total: number;
  plugin: number;
  pluginError: number;
  model: number;
  safetyRefuse: number;
  fallthroughRate: number | null;
  byPlugin: { pluginId: string; count: number }[];
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
