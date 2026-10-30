import { isDeviceRevoked, removeAllOfflineMedia } from "@/lib/offlineMedia";
import type { StatusAppsWire, AppRow as AppRowWire } from "@maipai/home-backend/src/wire";
import type { RobotState } from "@maipai/spec/gen/ts/robot-state.js";
import type { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { StatusNote } from "@maipai/spec/gen/ts/status-note.js";
import type { MaintenanceWindow } from "@maipai/spec/gen/ts/maintenance-window.js";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { Issue } from "@maipai/spec/gen/ts/issue.js";
import type { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import type { ChatFolder } from "@maipai/spec/gen/ts/chat-folder.js";
import type { ReplyFeedback } from "@maipai/spec/gen/ts/reply-feedback.js";
import type { Entity } from "@maipai/spec/gen/ts/entity.js";
import type { Relationship } from "@maipai/spec/gen/ts/relationship.js";
import type { TurnArtifact } from "@maipai/spec/gen/ts/turn-artifact.js";
import type { Artifact } from "@maipai/spec/gen/ts/artifact.js";
import type { Project } from "@maipai/spec/gen/ts/project.js";
import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";
import type { File as FileRecord } from "@maipai/spec/gen/ts/file.js";
import type { List as ListRecord } from "@maipai/spec/gen/ts/list.js";
import type { Alarm } from "@maipai/spec/gen/ts/alarm.js";

export type ComingUpItem = { id: string; kind: "alarm" | "reminder" | "timer"; text: string; at: string; total_seconds?: number };
export type QuickTimerView = { id: string; name: string; minutes: number; position: number };
export type WorldPlaceView = { id: string; name: string; country: string; zone: string; position: number };
export type AlarmView = Alarm & { next_at: string | null };
import type { Share } from "@maipai/spec/gen/ts/share.js";
import type { SttStatusResponse } from "@maipai/spec/voice/ts/sttTypes.js";
import type { SearchGroup } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderSearch";
import type {
  Roster,
  TurnValue,
  Media,
  TurnStreamEvent,
  StructuredPart,
  ConversationTurnRow,
  ConversationTurnWithMemoryIds,
  ConversationSummary,
  ResolvedSetting,
  BackupInfo,
  HardwareInfo,
  ModelFit,
  ChatModelOption,
  ChatModelsResponse,
  ChatCapabilities,
  EngineStatus,
  EngineStatsSample,
  StackVoice,
  RoutingStats,
  PrivacyConnection,
  PendingRestore,
  CommandRow,
  CommandAction,
  NotificationDeliveryView,
  HealthStatus,
  EngineHealthEntry,
  Dashboard,
  SetupChecklistItem,
  DashboardActivityRow,
  DashboardTurnsPerDay,
  DashboardEngineCounts,
  StackRoleId,
  StackRoleInfo,
  StackEngineInfo,
  StackBudget,
  StackHealthItem,
  EnginesOverview,
  EnginesHealth,
  BareCompareEvent,
  BareCompareTrace,
  TurnStats,
  Performance,
  PerformanceTurnDayStats,
  PerformanceEngineStats,
  PerformanceQueues,
  PerformanceLabels,
  PerformanceLayers,
  PerformanceLayerStats,
  PerformanceEngines,
  PerformanceHardware,
  PerformanceDisk,
  PersonStorageRow,
  StorageUsageOverview,
  PackageCacheSourceRow,
  TurnErrorDetail,
} from "@maipai/home-backend/src/wire";
import { isOwnerOrAdminRole, canHaveTemporaryChatRole } from "@maipai/home-backend/src/wire";
import type { RobotSelfTestPart, RobotSelfTestResult } from "@maipai/home-backend/src/wire";
export type { RobotSelfTestPart, RobotSelfTestResult } from "@maipai/home-backend/src/wire";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";

// GET /api/people (routes/people.ts) returns toRoster()'s output directly
// - the same Omit<Person, "birthdate"> shape Roster wraps, minus
// Roster's own hasSecret (that field only exists on /api/auth/profiles'
// response, added by that route, not toRoster() itself). Derived from
// the real spec type rather than hand-listing fields again.
//
// sessionLockRequired/sessionLockTimeoutMinutes (INCOGNITO-07): derived,
// settings-backed fields routes/people.ts merges onto every roster entry
// (withSessionLock()) - visible to every signed-in household member the
// same as role already is, editable only by owner/admin (routes/
// people.ts's own pre-check, settings.ts's assertCanSetSessionLock()).
export interface SiteBlocksView {
  band: "child" | "teen" | "adult";
  label: string;
  resetLabel: string;
  rows: Array<{ id: string; label: string; does: string }>;
  defaults: string[];
  mine: string[];
  locked: string[];
  setBy: Record<string, string>;
}

export interface PersonalApiKey {
  id: string; person_id: string; name: string; scopes: Array<"turn" | "code" | "settings" | "diagnose" | "engine">; created_at: string; expires_at: string;
  revoked_at: string | null; status: "active" | "expired" | "revoked" | "suspended"; last_used_at: string | null;
  suspended_reason: string | null;
  last_used_from: { place: "home_network" | "away"; address: string } | null; limits: { requests_per_minute: number };
  hint: string; provenance: string; hlc: string;
}
export interface AdminApiKey {
  id: string; person_id: string; scopes: Array<"turn" | "code" | "settings" | "diagnose" | "engine">; status: PersonalApiKey["status"];
  created_at: string; expires_at: string; revoked_at: string | null; hint?: string;
}
export interface CodingPiece {
  id: "engine" | "model" | "draft"; name: string; label: string; summary: string;
  state: "installed" | "installing" | "notInstalled" | "failed" | "unsupported";
  size_bytes: number | null; percent: number | null; failure: string | null;
  can_install: boolean; install_block: string | null; can_remove: boolean; remove_block: string | null;
}
export interface CodingPiecesView {
  stack: "ok" | "unreachable"; message: string | null; coding_enabled: boolean; engine: "splash" | "llama-server" | null;
  missing: string | null; pieces: CodingPiece[];
}
export interface CodingModeReadinessView {
  ready: boolean;
  first_unmet: CodingModeReadinessItemId | null;
  checked_at: string;
  items: CodingModeReadinessItem[];
  provenance: string;
  hlc: string;
}
export type CodingModeReadinessItemId = "coding_enabled" | "engine" | "pieces" | "hardware" | "memory" | "self_test" | "client" | "bench";
export interface CodingModeReadinessItem {
  id: CodingModeReadinessItemId;
  state: "done" | "can_do" | "manual";
  reason_key: CodingModeReadinessItemId;
  doc_anchor: string;
}
export interface CodingModeView { readiness: CodingModeReadinessView; mode: "normal" | "coding"; state: string; reason: string | null }
export interface SetupCodingView {
  eligible_mode: boolean;
  pieces: Array<{ id: CodingPiece["id"]; label: string; size_bytes: number | null; state: CodingPiece["state"] }>;
  total_bytes: number;
  readiness: CodingModeReadinessView;
}
export interface CodingGrant {
  id: string; person: string; action: string; effect: "allow" | "deny"; valid_from?: string | null; valid_to?: string | null;
  granted_by_person_id: string; created_at: string; deleted_at?: string | null;
}

export interface ReferenceBookView {
  id: string; source_label: string; language: string | null; size_bytes: number | null;
  snapshot_date: string | null; licence: string; article_count: number;
}
export interface ReferenceSuggestion { title: string; book: string; path: string }
export interface WebSearchState { address: string; works: boolean | null; stackOwned: boolean; sources: ("searxng" | "ddgs")[]; ddgsReady: boolean }
export interface ReferenceSearchHit { title: string; snippet: string; book: string; path: string }
export type ReferenceInline = string | { type: "text" | "emphasis" | "strong"; text: string } | { type: "link"; text: string; href?: string; book?: string; path?: string };
export type ReferenceBlock =
  | { type: "heading"; level: number; id: string; text: string }
  | { type: "paragraph"; inlines: ReferenceInline[] }
  | { type: "list"; ordered: boolean; items: ReferenceInline[][] }
  | { type: "rows"; rows: Array<{ label: string; value: string }> }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "figure"; src: string; alt: string; caption?: string }
  | { type: "note"; text: string };
export interface ReferenceArticleView {
  title: string; book: string; path: string; source_label: string; licence: string;
  snapshot_date: string | null; blocks: ReferenceBlock[];
  toc: Array<{ id: string; title: string; level: number }>;
  // READER-01, 02b and 10: all optional; a child's or teen's copy carries no `related`.
  profile?: "wikipedia" | "generic";
  description?: string; kicker?: string; lead?: string; hatnote?: string; summary?: string; reading_minutes?: number; quick_fact?: string; badge?: string;
  lead_image?: { src: string; alt: string };
  infobox?: { title?: string; image?: { src: string; alt: string }; rows: Array<{ label: string; value: string }> };
  related?: Array<{ book: string; path: string; title: string; thumbnail?: { src: string; alt: string } }>;
}
export interface ReferencePreview { title: string; summary: string; description?: string; kicker?: string; lead?: string; thumbnail?: { src: string; alt: string } }
export interface ReferenceSearchPage { hits: ReferenceSearchHit[]; total: number }

export type PersonRosterEntry = Omit<Person, "birthdate"> & {
  sessionLockRequired: boolean;
  sessionLockTimeoutMinutes: number;
  age_band: "child" | "teen" | "adult";
};

/** The chat-project routes add caller-specific access and summary fields to
 * the shared ChatFolder record. */
export type ChatFolderView = ChatFolder & {
  access: "manage" | "edit" | "use";
  last_activity_at: string;
  counts: { chats: number; files: number; artifacts: number };
};
export type ChatFolderPatch = {
  name?: string;
  color?: string;
  icon?: string;
  description?: string;
  instructions?: string;
  memory_mode?: string;
  pinned?: boolean;
  archived?: boolean;
};

// The signed-in person's own roster entry, as /api/auth/me actually
// returns it - Roster (wire.ts) also backs /api/auth/profiles, reachable
// signed OUT (the picker), so the two session-lock fields are added here
// rather than on Roster itself: a structural superset, so this still
// satisfies every existing `person: Roster` prop unchanged.
export type SignedInPerson = Roster & {
  sessionLockRequired: boolean;
  sessionLockTimeoutMinutes: number;
  age_band: "child" | "teen" | "adult";
};
export type Role = Person["role"];

export interface StatusBoardNote { id: string; body: string; posted_at: string; posted_by_name: string }
export interface StatusMaintenance { id: string; title: string; description: string; components: string[]; starts_at: string; ends_at: string; rrule?: string; until?: string; status: "scheduled" | "in_progress" | "completed" | "cancelled" }
export interface StatusBoard { note: StatusBoardNote | null; maintenance: StatusMaintenance[] }
export interface ReferenceSelection { source: string; flavour: "mini" | "maxi" | "nopic" | "default" }
export interface ReferenceSet { id: string; source: string; flavour: string; name: string; snapshotDate: string | null; sizeBytes: number; sha256: string; installed: boolean; child: boolean; wikipedia: boolean }
export interface ReferencePlan { preset: string; sets: ReferenceSet[]; totalBytes: number; freeBytes: number; freeAfterInstallBytes: number; requiredFreeBytes: number; refusal: string | null; swapHeadroomBytes: number; estimatedSeconds: number | null; warnings: string[]; settings: Record<string, string | number | boolean> }
export interface ReferenceJob { id: string; setId: string; state: "queued" | "waiting_window" | "downloading" | "paused" | "done" | "failed" | "cancelled"; completedBytes: number; totalBytes: number; message: string | null }
export interface ReferenceLibraryState { installed: Array<{ id: string; name: string; book: string; language: string; flavour: string; snapshotDate: string | null }>; jobs: ReferenceJob[]; matchesPresets: string[] }
export interface ReferenceCatalogSet extends ReferenceSet { language: string; bands: string[]; available: boolean; message: string | null }

// PROJECT-PROGRESS-01: routes/projects.ts's own GET response, a real
// Project (@maipai/spec) plus the one derived sibling field that route
// adds (post.ts's own postedProjectArtifact()) - the same "structural
// superset over the spec shape" pattern SignedInPerson above already is
// for Roster.
export type ProjectView = Project & { posted_artifact: { id: string; version: number } | null };

// Real backend types, imported from @/wire (not hand-duplicated): a code
// review (2026-09-04) flagged an earlier version of this file for
// hand-typing mirrors of these three, which could silently drift from the
// real shapes since nothing linked them. Importing the retired turn engine or
// conversationHistory.ts directly instead of @/wire does not work here:
// those files (and personShape.ts) pull in backend's own "@/..." path
// aliases, which frontend's tsconfig has no mapping for - @/wire exists
// specifically because it has no such imports. frontend/package.json
// depends on @maipai/home-backend as a workspace package for this;
// re-export the types here so the rest of the frontend imports from one
// place.
export type { TurnErrorDetail };
/** MODEL-SWITCH-01: where the choice of one catalog chat model stands. */
export type ChatModelChoice = { modelId: string; status: "none" | "downloading" | "loading" | "ready" | "failed"; reason?: string; jobs?: string[] };
export type { Roster, TurnValue, Media, TurnStreamEvent, StructuredPart, ConversationTurnRow, ConversationTurnWithMemoryIds, ConversationSummary, ResolvedSetting, BackupInfo, HardwareInfo, ModelFit, ChatModelOption, ChatModelsResponse, ChatCapabilities, EngineStatus, EngineStatsSample, StackVoice, RoutingStats, PrivacyConnection, PendingRestore, CommandRow, CommandAction, NotificationDeliveryView, HealthStatus, EngineHealthEntry, Dashboard, SetupChecklistItem, DashboardActivityRow, DashboardTurnsPerDay, DashboardEngineCounts, StackRoleId, StackRoleInfo, StackEngineInfo, StackBudget, StackHealthItem, EnginesOverview, EnginesHealth, BareCompareEvent, BareCompareTrace, TurnStats, Performance, PerformanceTurnDayStats, PerformanceEngineStats, PerformanceQueues, PerformanceLabels, PerformanceLayers, PerformanceLayerStats, PerformanceEngines, PerformanceHardware, PerformanceDisk, PersonStorageRow, StorageUsageOverview };
export type { ReplyFeedback };
export type { MemoryRecord };
export type { Entity };
export type { SttStatusResponse };
export type { Relationship };
export type { PackageManifest };
export type { Issue };
export type { Conversation };
export type { Project };
export { isOwnerOrAdminRole, canHaveTemporaryChatRole };
// SettingsKey is spec-generated (@maipai/spec), not backend-only, so it's
// imported directly rather than through @/wire.
export type { SettingsKey };
// SafetyResult flows through TurnValue.safety; re-exported for callers
// that want it by name without reaching into @maipai/spec directly.
export type { SafetyResult };

// Frozen from wave-2.md's "D to E: the store, widgets, lists" contract
// (2026-09-06). GET /api/widgets and GET /api/widgets/:package/:id/data
// don't exist on the backend yet (confirmed with session D: genuinely
// not started as of this writing) - hand-typed here rather than
// imported from @maipai/home-backend/src/wire (this file's own stated
// convention, above) because there is nothing there yet to import. A
// deliberate, temporary exception, not a second definition competing
// with a real one: swap this block for a @/wire import the moment D's
// route lands, so nothing here can drift from the real shape by hand.
export interface WidgetDescriptor {
  package: string;
  id: string;
  title: string;
  size: "card" | "row";
  refresh_s: number;
}
export interface HomeWidgets {
  hero: WidgetDescriptor | null;
  cards: WidgetDescriptor[];
  more: WidgetDescriptor[];
}
export interface WidgetItem {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: string;
  href?: string;
  image?: string;
}
export interface WidgetData {
  as_of: string;
  items: WidgetItem[];
  /** Set only when `items` is a handler's fallback text, not real data (backend/src/lib/widgets.ts). */
  degraded?: true;
  /** A `weather_card` answer block for an adult; drawn by the Today row instead of `items`. */
  card?: Record<string, unknown>;
}

// Real and landed (F step 6, merged into this branch 2026-09-06):
// GET/DELETE /api/devices and GET/DELETE /api/auth/sessions. Hand-typed
// to match `backend/src/routes/{devices,authSessions}.ts`'s own zod
// schemas exactly, not imported from `@/wire`: neither route re-exports
// a wire type today (they're typed inline via `@hono/zod-openapi`'s
// `createRoute`, a newer pattern than this file's usual `@/wire` re-
// export convention) - update this to a real import if that changes.
export interface DeviceInfo {
  id: string;
  kind: "robot" | "pod" | "tv" | "phone" | "desktop" | "browser";
  name: string;
  area: string | null;
  lastSeenAt: string | null;
  /** Robots only: the body reports the unit connected right now. */
  online?: boolean;
  createdAt: string;
  ipAddress?: string;
  /** The household robots route: who the robot belongs to, shown to everyone like a pet's owner. */
  ownerName?: string;
  ownerId?: string;
  capabilities: string[];
  /** ROBOT-CARD-01: robots only; `null` until the first report. */
  offlineScope?: Array<"media.offline" | "offline.records">;
  state?: RobotDeviceState | null;
}

/** ROBOT-COMPANION-01: GET /api/devices/{id}/companion (admin). `companions` lists only those the robot's controls allow. */
export interface RobotCompanionInfo {
  controls: "child" | "teen" | "adult";
  companion_id: string;
  /** `audience` is who the companion is for: all (dynamic, any robot), teen or adult (explicit). `type` is the lowest controls level that may use it. */
  companions: Array<{ id: string; name: string; type: "child" | "teen" | "adult"; audience: "all" | "teen" | "adult" }>;
  home_location_set: boolean;
  /** The voice the robot speaks in and where it comes from: its own setting, its companion's voice, or Home's default. "default" is the built-in voice. */
  speaking: { voice_id: string; source: "robot" | "companion" | "home"; companion_name?: string };
}

/** COMPANIONS-APP-01: GET /api/companions and /api/companions/{id} (backend/src/routes/companions.ts). */
export interface CompanionCard {
  id: string; name: string; type: "child" | "teen" | "adult"; type_label: string; tagline: string; who_can_use: string;
  dials: Array<{ label: string; value: string }>; voice: string; is_default: boolean; is_household: boolean; portrait?: string | null; status: string; chats: number; can_edit: boolean; can_copy: boolean;
  task_count?: number; chat_count?: number; working_count?: number; waiting_count?: number; latest_activity?: string | null;
}
export interface CompanionActivity { activity: Array<{ id: string; kind: string; title: string; state: string; created_at: string; updated_at: string; conversation_id?: string | null; placement?: "chat" | "side"; waiting_reason?: string | null; progress?: string | null; result_ref?: string | null; needs_you?: boolean }> }
export interface CompanionDetail extends CompanionCard {
  about: string; pronouns: string | null; interests: string[]; examples: string[]; voice_value: string; voice_is_own: boolean; voice_setting: string | null;
  used_by: { people: Array<{ id: string; name: string }>; robots: Array<{ id: string; name: string }> } | null;
}
export type CompanionPersonality = "friendly" | "funny" | "calm" | "professional" | "playful" | "custom";
export type CompanionStatus = "draft" | "ready" | "rendering" | "needs_review";
export interface CompanionEditable {
  id: string; name: string; pronouns: string | null; tagline: string; backstory: string; interests: string[];
  formality: "casual" | "neutral" | "formal"; complexity: "simple" | "standard" | "advanced"; engagement: "brief" | "balanced" | "curious"; filler_density: "none" | "light" | "frequent";
  clock_style?: "formal" | "plain" | "loose"; hedging?: "low" | "medium" | "high"; humor?: "low" | "medium" | "high"; warmth?: "low" | "medium" | "high"; initiative?: "low" | "medium" | "high";
  behavior: string[]; examples: string[]; examples_child: string[]; examples_teen: string[]; examples_adult: string[]; voice_id: string; look_prompt: string; audience: "adult" | "teen" | "all"; status: CompanionStatus; review: unknown; can_edit: boolean; can_copy: boolean; can_set_audience: boolean; look: { versions: number; rest: string | null; sheet_state: "empty" | "making" | "needs_review" | "approved" }; states: { approved: number; total: number };
}
export type CompanionFields = Partial<Omit<CompanionEditable, "id" | "status" | "review" | "can_edit" | "can_set_audience" | "look" | "states">>;
export interface CompanionList {
  allowed: boolean; can_create: boolean; can_discover: boolean; default_id: string;
  companions: CompanionCard[];
  discover: CompanionCard[];
  robots: Array<{ id: string; name: string; controls: "child" | "teen" | "adult"; companion_id: string; companion_name: string | null }> | null;
}

export interface CompanionLookVersion { id: string; label: string; source: "upload" | "generated" | "edit"; width: number; height: number; created_at: string; from: string | null; clipped?: string[]; url: string }
export interface CompanionLookView { version_id: string; url: string }
type CompanionLookKey = `#${"00FF00" | "FF00FF"}`;
export interface CompanionLookSheet { views: { left: CompanionLookView | null; right: CompanionLookView | null; mouth: CompanionLookView | null }; card: { text: string; colours: string[]; species: string } | null; key: CompanionLookKey; state: "empty" | "making" | "needs_review" | "approved"; approved_by: string | null; approved_at: string | null }
export interface CompanionLook { versions: CompanionLookVersion[]; rest: string | null; key: CompanionLookKey; sheet: CompanionLookSheet | null; ready_for_video: boolean; start_ready: boolean; start_reason?: string; can_generate: boolean; generate_reason?: string; styles: Array<{ id: string; label: string; custom?: boolean }>; keep?: { id: "keep"; label: string }; audience_cap?: "all" | "teen" | "adult" }
export interface CompanionLookJob { state: "queued" | "running" | "done" | "failed" | "cancelled"; percent: number; label: string; versions: Array<{ id: string; url: string; label: string }>; error: string | null }
export interface CompanionPromptPack { title: string; prompt: string; negative_prompt: string; text: string }
export interface CompanionStateUrls { h264: string; av1: string | null; still: string }
/** Signed-in person's ready avatar clips for chat. */
export interface CompanionAvatarView {
  avatar: null | {
    id: string;
    name: string;
    key: string;
    version: number;
    portrait?: string | null;
    states: Record<string, { loop: boolean; urls: { h264: string | null; av1: string | null; still: string } }>;
  };
}
export interface CompanionStateTake {
  id: string; label: string; source: "generated" | "upload"; created_at: string; ok: boolean | null; reasons: string[];
  seconds: number | null; bytes: { h264: number; av1: number | null } | null; colour_distance: number | null; area_ratio: number | null;
  report?: { ok: boolean; reasons: string[]; seconds: number; bytes: { h264: number; av1: number | null }; colour_distance: number | null; area_ratio: number; loop_gap: number; opaque_share: { min: number; max: number } } | null;
  urls: CompanionStateUrls; is_best: boolean;
}
export interface CompanionStateRow {
  id: string; label: string; kind: "loop" | "oneshot"; required: boolean; when_it_plays: string; default_motion: string; motion: string;
  approved: { take_id: string; approved_by: string | null; approved_at: string | null; urls: CompanionStateUrls } | null;
  takes: CompanionStateTake[]; busy: boolean;
  /** UI-3S-01b: the editable still made before the clip, the clip older than it, and the plain status words from Home. */
  keyframe?: { url: string; edited_at: string | null } | null; clip_out_of_date?: boolean;
  status?: "missing" | "ready" | "waiting" | "Needs another try"; status_label?: string;
}
export interface CompanionStates {
  sheet_ready: boolean; start_ready: boolean; start_reason?: string; busy?: { kind: "sheet" | "picture"; label: string; percent: number } | null; key: string; states: CompanionStateRow[]; run: { job: string; label: string; percent: number } | null;
  counts: { approved: number; total: number; required_missing: string[] };
}
export interface CompanionAppearance {
  has_changes: boolean;
  can_publish: boolean;
  reasons: string[];
  published: { at: string; by: string | null; states: Record<string, string> } | null;
  states: Array<{ state: string; assigned_take: string | null; approved: boolean; published_take: string | null; changed: boolean }>;
  portrait_changed: boolean;
}
export interface CompanionStateRun { state: "queued" | "running" | "done" | "failed" | "cancelled"; label: string; percent: number; current: { state: string; take: number; index: number; of: number } | null; takes_made: number; error: string | null }
export interface CompanionStateJob { state: "running" | "done" | "failed"; label: string; report?: { ok: boolean; reasons: string[]; seconds: number; bytes: { h264: number; av1: number | null }; colour_distance: number | null; area_ratio: number; loop_gap: number; opaque_share: { min: number; max: number } }; failure?: string }

export type MemoryRecordWithDevice = MemoryRecord & { device_name?: string };
// ROBOT-CARD-01: the robot's last reported frame plus the hub's derived
// reachability, hand-typed to match backend/src/routes/devices.ts's
// DeviceSchema.state.
export interface RobotDeviceState {
  activity: RobotState["activity"];
  muted: boolean;
  tracking: boolean;
  on_battery?: boolean | null;
  battery_level?: number | null;
  daemon_version?: string | null;
  app_version?: string | null;
  motion?: RobotState["motion"];
  put_down_count?: number;
  motors_latched?: RobotState["motors_latched"];
  motors_stuck?: RobotState["motors_stuck"];
  /** spec-v0.1.151: latched motors the robot offers to restart; the hub drops a motor once an adult has answered. */
  motors_reboot_offer?: RobotState["motors_reboot_offer"];
  thermal?: RobotState["thermal"];
  reachable: boolean;
  unreachableSince: string | null;
}
// ROBOT-DEVICE-01: hand-typed to match backend/src/routes/devices.ts's
// DiscoveredRobotSchema, same reasoning as DeviceInfo above (inline
// zod, no @/wire export yet).
export interface DiscoveredRobotInfo {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  model: string | null;
  daemonVersion: string | null;
  unitId: string | null;
}
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}
// Hand-typed for the same reason as DeviceInfo/SessionInfo above:
// backend/src/routes/updates.ts's own UpdateProjectionSchema, not
// imported from @/wire - the real UpdateProjection interface
// (backend/src/lib/updates.ts) carries @/db-aliased imports frontend's
// tsconfig has no mapping for.
// HOME-STACK-05: additive to the app's own flat fields above (org
// CLAUDE.md > Compatibility) - null for every household without a
// Stack. Reference sets have a separate nullable projection below.
export interface StackEngineUpdate {
  name: string;
  installed: string | null;
  available: string | null;
  availableKnown: boolean;
  lastChecked: string | null;
  notes: string | null;
}

export interface StackModelUpdate {
  id: string;
  installed: string;
  available: string | null;
}

export interface StackUpdatesProjection {
  checksEnabled: boolean;
  engines: StackEngineUpdate[];
  models: { lastChecked: string | null; entries: StackModelUpdate[] };
}

export interface ReferenceUpdate {
  id: string;
  name: string;
  installed: string | null;
  available: string | null;
  lastChecked: string;
  notes: string | null;
}

export interface ReferenceUpdatesProjection {
  lastChecked: string;
  entries: ReferenceUpdate[];
}

export interface AppUpdateProjection {
  installed: string;
  latest: string | null;
  summary: string | null;
  url: string | null;
  checkedAt: string | null;
  error: string | null;
}

export interface UpdateProjection extends AppUpdateProjection {
  stack: StackUpdatesProjection | null;
  stackError: string | null;
  reference: ReferenceUpdatesProjection | null;
  referenceError: string | null;
  robots: RobotUpdate[];
  robotsError: string | null;
}

// ROBOT-UPDATES-01: one entry per paired robot, hand-typed to match
// backend/src/routes/updates.ts's RobotUpdateSchema.
export interface RobotUpdate {
  id: string;
  name: string;
  installed: string | null;
  latest: string | null;
  daemonVersion: string | null;
  updateAvailable: boolean;
  blockedBy: string | null;
  lastChecked: string | null;
}

// GET /api/plugins's real row shape (backend/src/routes/plugins.ts):
// every field PackageManifest already declares, plus the live status
// routes/plugins.ts adds. `smoke` is `Omit`-and-replaced, not just
// added: the manifest's own `smoke` field (how to run the package's
// smoke test) and this route's own `smoke` field (the live result of
// the last run) are two different shapes sharing one key name -
// routes/plugins.ts's own spread (`{...manifest, ..., smoke: {...}}`)
// really does overwrite the former with the latter on the wire, so this
// type says so rather than conflict with PackageManifest's own
// declaration.
export interface InstalledPackage extends Omit<PackageManifest, "smoke"> {
  installed_version: string;
  latest_version: string;
  channel: "stable" | "beta";
  status: "enabled" | "disabled";
  smoke: { last_run_at: string | null; ok: boolean | null; message: string | null };
}

export interface TourProgressRecord {
  id: string; person_id: string; tour_id: string; package_id: string; version: number;
  status: "completed" | "skipped" | "dismissed"; step_reached: string; at: string; source: string; hlc: string; provenance: string;
}

// GET /api/plugins/skills's row (backend/src/routes/plugins.ts, SKILLS-PAGE-01).
export interface SkillRow {
  id: string;
  kind: "plugin" | "skill" | "project";
  name: string;
  description: string;
  /** Ships with Home, or added to this home from the catalog. */
  origin: "bundled" | "store";
  status: "enabled" | "disabled";
  /** Offered in the signed-in person's written chat today. */
  used_in_chat: boolean;
  /** Explicit reason a package tool is not offered, when known. */
  offer_label: string | null;
}

// GET /api/store/installs/:id's response (backend/src/routes/store.ts's
// InstalledPackageSchema): null when the package has no active store
// install (bundled-only, or never installed through the store) - the
// Apps page's pane checks this before offering Remove, since uninstall
// has nothing real to do for a package that's never gone through it.
export interface StoreInstall {
  id: string;
  version: string;
  previousVersion: string | null;
  channel: "stable" | "beta";
  sourceCommit: string;
  permissions: string[];
  installedAt: string;
}

// GET /api/files's response (routes/files.ts's VisibleFileSchema):
// `shared: false` for a file the signed-in person owns, `true` for one
// a share pointer makes visible to them - `owner_person_id` is always
// the real owner, never the viewer, so the Library page can show "with
// Sage" on anything that isn't the viewer's own.
// GET /api/people/{id}/deletion-preview (routes/people.ts).
export interface PersonDeletionPreview {
  files: { purged: { files: number; bytes: number }; keptForHousehold: { files: number; bytes: number } };
  export: { allowed: boolean; url: string | null };
}

export interface LibraryQuery {
  cursor?: string; limit?: number; type?: string; owner?: string;
  shared?: "with-me" | "by-me" | "none"; search?: string;
  sort?: "newest" | "oldest" | "name" | "size";
}
export interface LibraryItem {
  id: string; kind: "image" | "video" | "audio" | "document" | "story" | "file";
  name: string; media_type: string; size_bytes: number; created_at: string;
  owner: { id: string; display_name: string };
  shared_with: { count: number; household: boolean };
  retention: string; origin?: "made" | "sent" | "fetched"; chat_id: string | null; turn_id?: string | null; chat_title?: string | null; chat_deleted?: boolean; can_edit: boolean;
  audience: "all-ages" | "adult-only" | null; duration_seconds: number | null;
  thumb_url: string; expires_at: string | null; version_count: number;
}
export interface LibrarySongDetails {
  id: string; title: string | null; description: string | null; lyrics: string | null;
  timed_lyrics: { t: number; line: string; section: string | null }[] | null; cover_url: string | null;
  versions: { id: string; label: string; url: string }[]; current_id: string | null; owner: boolean;
}
export type FileRecordWithChat = FileRecord & { chat_id?: string | null; turn_id?: string | null; chat_title?: string | null; chat_deleted?: boolean; music?: LibrarySongDetails };
export interface LibrarySummary {
  items: number; bytes: number; per_kind: Record<string, { items: number; bytes: number }>;
  trash: { items: number; bytes: number }; expiring: { items: number; bytes: number };
}
export interface LibraryTrashItem {
  kind: string; id: string; title: string; deleted_at: string; trash_until: string | null;
  can_restore: boolean; can_purge: boolean; thumb_url?: string | null;
}
function libraryParams(query: LibraryQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

export interface VisibleFile {
  file: FileRecord;
  owner_person_id: string;
  shared: boolean;
  /** STORE-DELETE-01: shared by someone no longer in the household, so
   * the household's now; `former_owner_name` is who shared it. */
  household: boolean;
  former_owner_name: string | null;
}

// FACE-02: GET/POST /api/biometric-prints's response shape
// (routes/biometricPrints.ts's SummarySchema) - a plain frontend-side
// mirror, not sourced from wire.ts, since this route's only consumer so
// far is the face-enrollment flow and adding it to wire.ts would widen
// every frontend-only change here to a full gate the moment
// biometricPrints.ts itself changes (scripts/gateScope.ts's
// frontend-imports-backend rule). Never carries the embedding - see
// backend/src/lib/biometricPrints.ts's own header for why.
export interface BiometricPrintSummary {
  id: string;
  person_id: string;
  modality: "face" | "voice";
  model_id: string;
  model_sha256: string;
  dim: number;
  captured_by: string | null;
  consent_at: string;
  consented_by_person_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  hlc: string;
}

// GET /api/vision/models's response (routes/vision.ts) - the fixed list
// of face detector/embedder models the browser can load, each with the
// model id the backend actually validates against in
// lib/biometricPrints.ts's KNOWN_MODELS. Read from here instead of
// hardcoding the SFace model id a second time on the frontend.
export interface VisionModelInfo {
  id: string;
  label: string;
  file: string;
}

export interface HostTuneItem { id: string; title: string; why: string; mode: "auto" | "consent" | "advice"; state: "ok" | "needs" | "unknown" | "applied"; current: string; proposed: string }
export interface HostTuneView { supported: boolean; items: HostTuneItem[] }

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    /** The routes' own "what to do next" sentence, when they send one. */
    public next?: string,
    /** Seconds until a lockout (429) ends, when the route sends it. */
    public retryAfter?: number,
    /** Field-level validation messages returned by editable forms. */
    public fields?: Record<string, string>,
    /** Reasons a publish or other decision was blocked. */
    public reasons?: string[],
    /** A clip request answered 409 needs_keyframe: the animations that have no keyframe yet, in order. */
    public missingKeyframes?: string[],
    /** A companion save answered 409 or 422 with the screen that fixes it. */
    public goBackTo?: "look" | "animations",
  ) {
    super(message);
  }
}

// `timeoutMs` is opt-in, not a default: most calls here (download-job
// polling, a multi-GB select) are legitimately long-running by design, so
// a global fetch timeout would be wrong for them. It exists for calls
// where a hang is never correct - a live incident (2026-09-04) left the
// AI models page stuck showing "Starting..." forever with no way out,
// because neither this client nor the browser's own fetch has any
// default timeout at all. The backend route itself now bounds the same
// wait server-side (routes/host.ts); this is the second, independent
// layer in case the hang is a dead connection the server never even
// sees.
//
// Shared by request<T>() and streamSpeech(): a code review (2026-09-04)
// found the two had independently hand-rolled the same
// AbortController-plus-setTimeout mechanics, which meant a future fix to
// one (like the signal-passthrough fix below) had to be remembered and
// reapplied to the other by hand.
function withTimeout(timeoutMs: number | undefined): { signal: AbortSignal | undefined; clear: () => void } {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  return {
    signal: controller?.signal,
    clear: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Every request is same-origin (Vite's dev proxy in dev, backend's own
// serveStatic in prod: vite.config.ts and app.ts) with the session
// cookie included: there is no header-based auth path at all
// (middleware/auth.ts), so `credentials: "include"` is not optional.
// Exported for the schema interpreter (kit/schema/binding.ts, step 5):
// a `route`-sourced binding or a `call` action target a JSON page
// authors is just a path string, not one of the named methods below, so
// the interpreter needs the same request plumbing (credentials,
// timeout, error shape) directly rather than duplicating it.
export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  // An explicit sign-out discards the copies (a shared browser). An expired session never does.
  if (path === "/api/auth/logout") await removeAllOfflineMedia();
  const { timeoutMs, ...rest } = init ?? {};
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const res = await fetch(path, {
      ...rest,
      credentials: "include",
      headers: rest.body instanceof FormData ? rest.headers : { "Content-Type": "application/json", ...rest.headers },
      // A code review (2026-09-04) found this unconditionally overwrote
      // whatever `signal` a caller passed via `init` - harmless today
      // (no call site passes its own signal), but silently discarding a
      // future caller's own cancellation the moment they didn't also
      // request `timeoutMs`. Only substitutes the timeout's signal when a
      // timeout was actually requested; otherwise passes through
      // whatever the caller gave (undefined, same as before this option
      // existed, or their own real signal).
      signal: signal ?? rest.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (isDeviceRevoked(res.status, body)) await removeAllOfflineMedia();
      throw new ApiError(body.error ?? res.statusText, res.status, body.code, typeof body.next === "string" ? body.next : undefined, typeof body.retryAfter === "number" ? body.retryAfter : undefined, body.fields && typeof body.fields === "object" ? body.fields as Record<string, string> : undefined, Array.isArray(body.reasons) ? (body.reasons as unknown[]).filter((reason): reason is string => typeof reason === "string") : undefined, Array.isArray(body.missing_keyframes) ? (body.missing_keyframes as unknown[]).filter((state): state is string => typeof state === "string") : undefined, body.go_back_to === "look" || body.go_back_to === "animations" ? body.go_back_to : undefined);
    }
    return body as T;
  } catch (err) {
    if (isAbortError(err)) {
      throw new ApiError(`Timed out after ${(timeoutMs ?? 0) / 1000}s`, 0, "timeout");
    }
    throw err;
  } finally {
    clear();
  }
}

// Shared by streamSpeech() and streamTurn(): both POST JSON and want the
// raw Response back (a streamed body the caller reads chunk by chunk),
// never routed through request<T>() since that always parses and awaits
// the whole body as JSON. `timeoutMs` only ever bounds waiting for the
// response to begin, never the body it streams back afterward - once
// headers arrive this returns and the timer clears, so a long stream's
// own duration is never cut off by it.
// `timeoutMessage` defaults to a generic string but every real caller
// passes its own: a code review (2026-09-04) found folding streamSpeech's
// timeout handling in here had silently replaced its specific "Timed out
// waiting for voice" with this generic text, a real if minor UX
// regression from the refactor.
//
// `externalSignal` (step 4, chat on assistant-ui): the runtime's own
// abortSignal for a stopped run, merged with the timeout's signal via the
// standard `AbortSignal.any` rather than hand-rolling a second listener -
// whichever fires first aborts the fetch, and `isAbortError` below can't
// tell the two apart anyway (neither needs to; a stopped run and a timed-
// out one both just end the stream).
async function rawStreamPost(
  path: string,
  body: unknown,
  timeoutMs: number,
  timeoutMessage = "Timed out waiting for a response",
  externalSignal?: AbortSignal,
  accept?: string,
): Promise<Response> {
  const { signal: timeoutSignal, clear } = withTimeout(timeoutMs);
  const signal =
    timeoutSignal && externalSignal
      ? AbortSignal.any([timeoutSignal, externalSignal])
      : (timeoutSignal ?? externalSignal);
  try {
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: accept ? { "Content-Type": "application/json", Accept: accept } : { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({}));
      throw new ApiError(parsed.error ?? res.statusText, res.status, parsed.code, undefined, undefined, undefined, Array.isArray(parsed.reasons) ? (parsed.reasons as unknown[]).filter((reason): reason is string => typeof reason === "string") : undefined);
    }
    return res;
  } catch (err) {
    if (isAbortError(err)) {
      throw new ApiError(timeoutMessage, 0, "timeout");
    }
    throw err;
  } finally {
    clear();
  }
}

/** Parses one POST /api/turn/stream response body into its real events
 * (wire.ts's TurnStreamEvent): newline-delimited JSON, one event per
 * line. readTextLines (@maipai/spec/streaming/ts/lineReader.js) owns the
 * buffer/decode/final-flush mechanics shared with spec/llm/ts/client.ts's
 * own SSE reader - a real bug (a missing TextDecoder final flush) had to
 * be fixed once per copy before this was centralized, a code review
 * (2026-09-04) flagged as the direct cause. */
export async function* readTurnStream(response: Response): AsyncGenerator<TurnStreamEvent, void, void> {
  for await (const line of readTextLines(response.body!.getReader())) {
    yield JSON.parse(line) as TurnStreamEvent;
  }
}

/** ADMIN-COMPARE-01: POST /api/turn/bare's own NDJSON, the readTurnStream
 * twin for the compare route's much smaller event shape (wire.ts's
 * BareCompareEvent). */
export async function* readBareCompareStream(response: Response): AsyncGenerator<BareCompareEvent, void, void> {
  for await (const line of readTextLines(response.body!.getReader())) {
    yield JSON.parse(line) as BareCompareEvent;
  }
}

export type ComputerMemory = { usableGb: number; usedGb: number; freeGb: number; pressure: "normal" | "warn" | "critical"; pressureText: string; loaded: Array<{ id: string; label: string; gb: number }>; homeOwnedRoles: Array<"chat" | "embeddings" | "stt" | "tts"> };
export type ComputerMemoryResponse = { available: true; memory: ComputerMemory } | { available: false };

export type FitPlanResponse = { plan: StackFitPlan | null; wording: { verdict: "yes" | "slow" | "no" | "unknown"; headline: string; detail: string } };

export type StatusHistoryState = "operational" | "degraded" | "outage" | "maintenance" | "none";
export type StatusHistoryMinutes = { operational: number; degraded: number; outage: number; maintenance: number };
export type StatusHistoryDay = { date: string; worst: StatusHistoryState; minutes: StatusHistoryMinutes };
export type StatusHistoryIncident = { component: "chat" | "embed" | "background" | "voice" | "library" | "hub" | "engine_computer"; started_at: string; ended_at: string | null; minutes: number; ongoing: boolean };
export type StatusHistoryComponent = { component: StatusHistoryIncident["component"]; uptime_percent: number | null; days: StatusHistoryDay[]; current: { state: StatusHistoryState; since: string | null } };
export type StatusMemoryLedger = { reserved_bytes: number; warm_bytes: number; burst_bytes: number; budget_bytes: number; working_margin_bytes: number; free_bytes: number; queue_depth: { reserved: number; warm: number; burst: number }; chat_paged_out: boolean };
export type StatusHistory = { generated_at: string; days: number; components: StatusHistoryComponent[]; incidents: StatusHistoryIncident[]; /** CHAT-PAUSE-01: how often chat stopped answering today, and why (counts only). */ chat_pauses?: { count: number; causes: Record<string, number>; line: string }; /** ROBUST-01: engines that stopped on their own today, and how many the Stack restarted. */ engine_crashes?: { count: number; healed: number; gave_up: number; line: string; days: Array<{ day: string; crashes: number; healed: number; gave_up: number }> }; /** MEMMGMT-2026-10-25: admin-only Stack ledger totals, absent on older Stacks. */ memory_ledger?: StatusMemoryLedger };

export type StatusAppsResponse = StatusAppsWire;
export type AppRow = AppRowWire;
/** GET /api/media/home: one row of the Media home's shelves (backend/src/routes/mediaHome.ts). */
export interface MediaHomeRow {
  id: string;
  app: "videos" | "shows" | "music" | "podcasts" | "books";
  kind: string;
  title: string;
  subtitle: string | null;
  artwork_url: string | null;
  href: string;
  percent: number | null;
  at: string;
}
export interface MediaHome { continue: MediaHomeRow[]; new: MediaHomeRow[]; recent_music: MediaHomeRow[]; made_at_home: MediaHomeRow[] }
export type MediaSearchRow = MediaHomeRow;
export interface MediaSearchGroup { app: MediaSearchRow["app"]; heading: string; rows: MediaSearchRow[] }
export interface MediaSearch { groups: MediaSearchGroup[] }
export type EngineComputerStatus = { configured: boolean; state: "working" | "connecting" | "slow_to_answer" | "reconnecting" | "not_reachable"; reason: string | null; details?: { path: "home" | "tailnet" | null; lastProbeAt: string | null; contract: string | null } };
export type StatusApp = StatusAppsResponse[number];
export type StatusAppNeed = NonNullable<StatusApp["needs"]>[number];
export type StatusAppState = StatusApp["state"];

/** ACTIVITY-01d: one row of GET /api/jobs (backend/src/routes/jobs.ts's
 * HomeJobSchema). A row about another adult carries only id, kind,
 * forPerson and durationSeconds. */
export interface HomeJobView {
  id: string;
  kind: string;
  state?: string;
  startedBy?: string;
  forPerson?: string | null;
  title?: string;
  progress?: Record<string, unknown> | null;
  waitingReason?: string | null;
  resultRef?: string | null;
  conversationId?: string | null;
  errorKind?: string | null;
  raw?: string | null;
  provenance?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  durationSeconds?: number;
  actions?: string[];
  /** Set when the row is about someone other than the viewer. */
  forPersonName?: string;
}

export interface TailscaleStatus { state: "not_installed" | "stopped" | "running"; dnsName: string | null; ips: string[]; installed: boolean; signedIn: boolean; httpsEnabled: boolean; machineName: string | null; enabled: boolean; url: string | null }

export interface SetupFolderListing { path: string; parent: string | null; freeBytes: number | null; writable: boolean; folders: Array<{ name: string; path: string; writable: boolean }> }
export interface SetupPlacementRow { class: string; kind: "refusal" | "warning" | "unknown"; id: string; text: string; fix: string }

/** The plan step's disk list: every install with its size, where the files land and the room each place has (the shared arithmetic totals a choice). */
export interface PlanDiskView {
  source: "stack" | "shipped";
  plan: import("../../../shared/diskPlanMath").DiskPlan;
  volumes: import("../../../shared/diskPlanMath").DiskVolume[];
  verdict: { state: "green" | "amber" | "red"; text: string; fix: string; requiredBytes: number; freeBytes: number | null };
}
export interface PlanWording {
  level: "recommended" | "moderate" | "minimal" | "below_minimum" | "unknown";
  headline: string; detail: string; gets: string[]; needsMemoryAnswer: boolean; sizeLine: string | null; diskLine: string | null;
  disk?: PlanDiskView | null;
}
/** The setup plan read: Home's words, the licences and the job cards Settings also shows (AIMODELS-SETUP-01). */
export interface PlanRead { plan?: unknown; wording: PlanWording; licences?: import("../../../shared/licensedRows").PlanLicence[]; choices?: import("../../../shared/aiChoices").AiChoicesResult | null }
export interface InstallStatusView {
  state: "none" | "installing_engine" | "engine_failed" | "downloading" | "starter_ready" | "stalled" | "out_of_space" | "failed" | "ready";
  chatReady: boolean; complete: boolean; percent: number; completedBytes: number; totalBytes: number;
  bytesPerSecond: number | null; etaSeconds: number | null; problem: string | null;
  /** While the AI engine itself installs: the step and its plain label. */
  stage?: string | null; stageLabel?: string | null;
  /** Parts installed later from Settings, Models and storage, still downloading. Never gates chat or voice. */
  background?: { state: "running" | "stalled"; label: string; percent: number; completedBytes: number; totalBytes: number; bytesPerSecond: number | null; etaSeconds: number | null; count: number } | null;
  items: Array<{ id: string; model: string; role: string | null; label: string; state: string; completedBytes: number; totalBytes: number; reason: string | null }>;
}

/** CANARY-01: GET /api/health-checks. */
export type HealthChecks = {
  running: boolean;
  last_checked_at: string | null;
  groups: Array<{ group: "chat" | "tools" | "search" | "voice" | "pictures"; label: string; state: "pass" | "fail" | "unknown" }>;
  checks: Array<{ id: string; name: string; group: string; state: "pass" | "fail" | "skipped" | "unknown"; at: string | null; duration_ms: number | null; first_token_ms: number | null; note: string | null }>;
};

export interface MediaBudgetResponse { limit_min: number; used_min: number; left_min: number; exhausted: boolean; /** The kid time-up words when time is up (GET /api/media/budget only). */ line?: string | null }

export const api = {
  lists: () => request<ListRecord[]>("/api/lists"),
  comingUp: () => request<ComingUpItem[]>("/api/coming-up"),
  startTimer: (label: string, minutes: number) => request<{ id: string }>("/api/coming-up/timers", { method: "POST", body: JSON.stringify({ label, minutes }) }),
  extendTimer: (id: string) => request<{ id: string; at: string; total_seconds: number }>(`/api/coming-up/${encodeURIComponent(id)}/extend`, { method: "POST" }),
  quickTimers: () => request<QuickTimerView[]>("/api/quick-timers"),
  createQuickTimer: (name: string, minutes: number) => request<QuickTimerView>("/api/quick-timers", { method: "POST", body: JSON.stringify({ name, minutes }) }),
  updateQuickTimer: (id: string, input: { name?: string; minutes?: number; position?: number }) => request<QuickTimerView>(`/api/quick-timers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteQuickTimer: (id: string) => request<{ id: string }>(`/api/quick-timers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  worldPlaces: () => request<WorldPlaceView[]>("/api/world-places"),
  createWorldPlace: (input: { name: string; country: string; zone: string; source: "local" }) => request<WorldPlaceView>("/api/world-places", { method: "POST", body: JSON.stringify(input) }),
  updateWorldPlace: (id: string, position: number) => request<WorldPlaceView>(`/api/world-places/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ position }) }),
  deleteWorldPlace: (id: string) => request<{ id: string }>(`/api/world-places/${encodeURIComponent(id)}`, { method: "DELETE" }),
  alarms: () => request<AlarmView[]>("/api/alarms"),
  createAlarm: (input: Partial<Pick<Alarm, "time" | "days" | "label" | "tag" | "enabled" | "sound" | "snooze_minutes">>) => request<AlarmView>("/api/alarms", { method: "POST", body: JSON.stringify(input) }),
  updateAlarm: (id: string, input: Partial<Pick<Alarm, "time" | "days" | "label" | "tag" | "enabled" | "sound" | "snooze_minutes">>) => request<AlarmView>(`/api/alarms/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteAlarm: (id: string) => request<{ id: string }>(`/api/alarms/${encodeURIComponent(id)}`, { method: "DELETE" }),
  skipNextAlarm: (id: string) => request<AlarmView>(`/api/alarms/${encodeURIComponent(id)}/skip-next`, { method: "POST" }),
  doneComingUp: (id: string) => request<{ ok: true }>(`/api/coming-up/${encodeURIComponent(id)}/done`, { method: "POST" }),
  snoozeComingUp: (id: string, input: { minutes?: number; until?: "tomorrow_morning" }) => request<{ ok: true }>(`/api/coming-up/${encodeURIComponent(id)}/snooze`, { method: "POST", body: JSON.stringify(input) }),
  addListItem: (listId: string, text: string, parseDue = false) => request<ListRecord>(`/api/lists/${encodeURIComponent(listId)}/items`, { method: "POST", body: JSON.stringify({ text, ...(parseDue ? { parse_due: true } : {}) }) }),
  createList: (input: { kind: "custom"; scope: "person"; title: string; icon: NonNullable<ListRecord["icon"]> }) => request<ListRecord>("/api/lists", { method: "POST", body: JSON.stringify(input) }),
  updateList: (listId: string, input: { title?: string; icon?: NonNullable<ListRecord["icon"]> }) => request<ListRecord>(`/api/lists/${encodeURIComponent(listId)}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteList: (listId: string) => request<{ id: string }>(`/api/lists/${encodeURIComponent(listId)}`, { method: "DELETE" }),
  editListItem: (listId: string, itemId: string, done: boolean) => request<ListRecord>(`/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify({ done }) }),
  clearDoneListItems: (listId: string) => request<ListRecord>(`/api/lists/${encodeURIComponent(listId)}/clear-done`, { method: "POST" }),
  companionAvatar: (companionId?: string) => request<CompanionAvatarView>(`/api/companions/avatar${companionId ? `?companion=${encodeURIComponent(companionId)}` : ""}`),
  mediaBudget: () => request<MediaBudgetResponse>("/api/media/budget"),
  referenceBooks: () => request<ReferenceBookView[]>("/api/reference/books"),
  referenceSuggest: (book: string | undefined, q: string) => request<ReferenceSuggestion[]>(`/api/reference/suggest?${book ? `book=${encodeURIComponent(book)}&` : ""}q=${encodeURIComponent(q)}`),
  referenceSearch: (q: string, book?: string) => request<ReferenceSearchHit[]>(`/api/reference/search?q=${encodeURIComponent(q)}${book ? `&book=${encodeURIComponent(book)}` : ""}`),
  referenceArticle: (book: string, path: string) => request<ReferenceArticleView>(`/api/reference/article/${encodeURIComponent(book)}/${encodeURIComponent(path)}`),
  referencePreview: (book: string, path: string) => request<ReferencePreview>(`/api/reference/preview/${encodeURIComponent(book)}/${encodeURIComponent(path)}`),
  referenceRandom: (book: string) => request<{ title: string; book: string; path: string }>(`/api/reference/random/${encodeURIComponent(book)}`),
  referenceSearchPage: async (q: string, book?: string): Promise<ReferenceSearchPage> => {
    const res = await fetch(`/api/reference/search?q=${encodeURIComponent(q)}${book ? `&book=${encodeURIComponent(book)}` : ""}`, { credentials: "include" });
    if (!res.ok) throw new ApiError(res.statusText, res.status);
    const hits = await res.json() as ReferenceSearchHit[];
    const total = Number(res.headers.get("X-Total-Results"));
    return { hits, total: Number.isFinite(total) && total >= hits.length ? total : hits.length };
  },
  referenceState: () => request<ReferenceLibraryState>("/api/reference/state"),
  referenceCatalog: () => request<ReferenceCatalogSet[]>("/api/reference/catalog"),
  referencePlan: (preset: "minimum" | "moderate" | "full" | "custom", selection?: ReferenceSelection[]) => request<ReferencePlan>("/api/reference/plan", { method: "POST", body: JSON.stringify({ preset, selection }) }),
  referenceApply: (preset: "minimum" | "moderate" | "full" | "custom", selection?: ReferenceSelection[]) => request<{ jobs: ReferenceJob[]; idempotent: boolean }>("/api/reference/apply", { method: "POST", body: JSON.stringify({ preset, selection }) }),
  referenceInstall: (id: string) => request<ReferenceJob>(`/api/reference/sets/${encodeURIComponent(id)}/install`, { method: "POST" }),
  referenceRemove: (id: string) => request<{ removed: boolean; freedBytes: number }>(`/api/reference/sets/${encodeURIComponent(id)}/remove`, { method: "POST" }),
  referenceJob: (id: string, action: "pause" | "resume" | "cancel") => request<ReferenceJob>(`/api/reference/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
  setupState: () => request<SetupState | { done: true }>("/api/setup/state"),
  setupChecks: () => request<{ rows: Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup" }>; state: SetupState; searchCandidate: string | null; searchNeeded?: boolean }>("/api/setup/checks/run", { method: "POST" }),
  setupReviewValues: () => request<{ engine: unknown; checks: Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string }> }>("/api/repairs/review"),
  repairsChecks: () => request<Array<{ id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string }>>("/api/repairs/checks", { method: "POST" }),
  setupAcceptLicences: () => request<{ accepted: true }>("/api/setup/licences/accept", { method: "POST" }),
  setupPlan: (vramGb?: number) => request<PlanRead>(`/api/setup/plan${vramGb ? `?vram_gb=${vramGb}` : ""}`),
  setupInstall: (vramGb?: number, components?: string[], acceptedLicences?: string[], settings?: Record<string, string | boolean>) => request<{ started: true; models: number }>("/api/setup/install", { method: "POST", body: JSON.stringify({ ...(vramGb ? { vram_gb: vramGb } : {}), ...(components ? { components } : {}), ...(acceptedLicences?.length ? { accepted_licences: acceptedLicences } : {}), ...(settings && Object.keys(settings).length ? { settings } : {}) }) }),
  /** Wizard (before an owner): start or restart the AI engine install on this computer. */
  setupEngineInstall: () => request<{ started: true }>("/api/setup/engine-install", { method: "POST" }),
  setupHostTune: () => request<HostTuneView>("/api/setup/host-tune"),
  setupHostTuneApply: (id: string) => request<{ item: HostTuneItem }>("/api/setup/host-tune/apply", { method: "POST", body: JSON.stringify({ id }) }),
  setupHostTuneRevert: (id: string) => request<{ item: HostTuneItem }>("/api/setup/host-tune/revert", { method: "POST", body: JSON.stringify({ id }) }),
  setupInstallStatus: () => request<InstallStatusView>("/api/setup/install"),
  installPlan: (vramGb?: number) => request<{ plan: unknown; wording: PlanWording; licences?: import("../../../shared/licensedRows").PlanLicence[] }>(`/api/install/plan${vramGb ? `?vram_gb=${vramGb}` : ""}`),
  installStart: (vramGb?: number, components?: string[], acceptedLicences?: string[]) => request<{ started: true; models: number }>("/api/install/start", { method: "POST", body: JSON.stringify({ ...(vramGb ? { vram_gb: vramGb } : {}), ...(components ? { components } : {}), ...(acceptedLicences?.length ? { accepted_licences: acceptedLicences } : {}) }) }),
  installStatus: () => request<InstallStatusView>("/api/install"),
  installRetry: () => request<{ started: true }>("/api/install/retry", { method: "POST" }),
  /** Wizard web search screen: `dryRun` tests the address and saves nothing. */
  setupUseSearchCandidate: (url: string, dryRun = false) => request<{ saved: boolean; result?: import("@/shell/components/searchTestResult").SearchTestResultData }>("/api/setup/search/use-candidate", { method: "POST", body: JSON.stringify(dryRun ? { url, dry_run: true } : { url }) }),
  /** Wizard web search screen, skipped: SearXNG stays unset and DuckDuckGo (adults only) is turned on. */
  // SEARXNG-SET-05: Settings > Search > Web search (owner and admin).
  searchWeb: () => request<WebSearchState>("/api/search/web"),
  searchAddress: (url: string, dryRun = false) => request<{ saved: boolean; cleared?: boolean; result?: import("@/shell/components/searchTestResult").SearchTestResultData }>("/api/search/address", { method: "POST", body: JSON.stringify(dryRun ? { url, dry_run: true } : { url }) }),
  setupSkipSearch: () => request<{ saved: boolean }>("/api/setup/search/use-candidate", { method: "POST", body: JSON.stringify({ ddgs_default: true }) }),
  setupAllowEngineTailnet: () => request<{ enabled: true }>("/api/setup/checks/allow-tailnet", { method: "POST" }),
  pullStackModel: (body: Record<string, unknown>) => request<Record<string, unknown>>("/api/engines/models/pull", { method: "POST", body: JSON.stringify(body) }),
  setupFolders: (path?: string) => request<SetupFolderListing>(`/api/setup/folders${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`),
  setupStorageDefaults: () => request<{ records: string; models: string; models_need_bytes?: number; chosen?: { records?: string; models?: string } }>("/api/setup/storage/defaults"),
  setupCreateFolder: (parent: string, name: string) => request<{ name: string; path: string; writable: boolean }>("/api/setup/folders", { method: "POST", body: JSON.stringify({ parent, name }) }),
  setupNativeFolder: (folder: "records" | "models") => request<{ status: "chosen"; path: string } | { status: "cancelled" } | { status: "unavailable" } | { status: "refused"; error: string }>("/api/setup/folders/native", { method: "POST", body: JSON.stringify({ folder }) }),
  setupStorageCheck: (layout: { models?: string; records?: string; split?: boolean }) => request<{ rows: SetupPlacementRow[] }>("/api/setup/storage/check", { method: "POST", body: JSON.stringify(layout) }),
  setupStep: (step: string, body: { status: "done" | "skipped" | "deferred" | "failed"; phase?: SetupState["phase"]; models?: string; records?: string; engine?: SetupState["engine"] }) =>
    request<SetupState>(`/api/setup/${encodeURIComponent(step)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  profiles: () => request<Roster[]>("/api/auth/profiles"),
  setup: (displayName: string, secret: string) =>
    request<{ person: unknown }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ displayName, secret }),
    }),
  setupCa: () => request<{ certificate: string }>("/api/setup/ca"),
  tailscaleStatus: () => request<TailscaleStatus>("/api/tailscale/status"),
  enableTailscale: () => request<{ url: string; qrPayload: string }>("/api/tailscale/enable", { method: "POST" }),
  select: (personId: string) =>
    request<{ success: true }>("/api/auth/select", {
      method: "POST",
      body: JSON.stringify({ personId }),
    }),
  verifySecret: (personId: string, secret: string) =>
    request<{ success: true }>("/api/auth/verify-secret", {
      method: "POST",
      body: JSON.stringify({ personId, secret }),
    }),
  changeSecret: (currentSecret: string | undefined, newSecret: string) =>
    request<{ success: true }>("/api/auth/change-secret", {
      method: "POST",
      body: JSON.stringify({ currentSecret, newSecret }),
    }),
  me: () => request<SignedInPerson>("/api/auth/me"),
  logout: () => request<{ success: true }>("/api/auth/logout", { method: "POST" }),
  // Session E step 6: "sessions and devices with revoke" - both scoped
  // to the caller's own profile (devices.ts's own comment: "not a
  // household-wide admin view"), the same personal-Profile-page scope
  // PIN/password change already has.
  devices: () => request<DeviceInfo[]>("/api/devices"),
  setDeviceOfflineScope: (id: string, offline_scope: Array<"media.offline" | "offline.records">) =>
    request<{ success: true }>(`/api/devices/${encodeURIComponent(id)}/offline-scope`, { method: "PATCH", body: JSON.stringify({ offline_scope }) }),
  revokeDevice: (id: string) =>
    request<{ success: true }>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateDevice: (id: string, input: { name?: string; area?: string | null }) =>
    request<DeviceInfo>(`/api/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  // ROBOT-DEVICE-01: "Add a robot" - discover a unit on the LAN, then
  // approve the code it spoke through Quick Connect's own existing
  // approve route (it already mints a "robot" device token generically;
  // no new pairing route was needed).
  discoverRobots: () => request<DiscoveredRobotInfo[]>("/api/devices/discover-robots"),
  // Household-wide, unlike devices() above: Quick Connect mints a robot's
  // device under whichever admin approved the pairing, so a different
  // admin still needs to find it here to rotate its password.
  robotDevices: () => request<DeviceInfo[]>("/api/devices/robots"),
  robotCompanion: (id: string) => request<RobotCompanionInfo>(`/api/devices/${encodeURIComponent(id)}/companion`),
  robotInstallStatus: (deviceId: string) => request<{ hosted: true; enrollment_pending: boolean }>(`/api/robots/hosts/${encodeURIComponent(deviceId)}/install-status`),
  robotSoftware: (deviceId: string) => request<{ firmware: { installed: { version: string; at: string } | null; available: string; status: "up_to_date" | "update_available" | "unknown" }; bot: { running: string | null; available: string; status: "up_to_date" | "restart_needed" | "unknown" }; checkin: { online: boolean; lastSeen: string; ip: string | null; rssi: number | null; signal: "strong" | "medium" | "weak" | null; battery: { level: number | null; charging: boolean | null }; boot_reason: number | null; crash_resets: number | null; heap: { internal: number | null; minimum: number | null; psram: number | null } } | null; lastSeenAt: string | null }>(`/api/robots/hosts/${encodeURIComponent(deviceId)}/software`),
  recordRobotFirmwareInstalled: async (deviceId: string) => {
    const software = await api.robotSoftware(deviceId);
    return request<{ recorded: true }>(`/api/robots/hosts/${encodeURIComponent(deviceId)}/firmware-installed`, { method: "POST", body: JSON.stringify({ version: software.firmware.available }) });
  },
  cancelRobotInstall: (deviceId: string) => request<{ removed: true }>(`/api/robots/hosts/${encodeURIComponent(deviceId)}/cancel-install`, { method: "POST" }),
  setRobotMuted: (id: string, muted: boolean) =>
    request<{ id: string }>(`/api/devices/${encodeURIComponent(id)}/commands`, {
      method: "POST",
      body: JSON.stringify({ kind: muted ? "mute" : "unmute" }),
    }),
  // MOTOR-REBOOT-CARD: an adult's answer to the robot's offer to restart a latched motor. Only "yes" sends a command.
  answerMotorReboot: (id: string, answer: "yes" | "no") =>
    request<unknown>(`/api/devices/${encodeURIComponent(id)}/motor-reboot`, { method: "POST", body: JSON.stringify({ answer }) }),
  robotSelfTest: (id: string, part: RobotSelfTestPart) =>
    request<RobotSelfTestResult>(`/api/devices/${encodeURIComponent(id)}/self-test`, { method: "POST", body: JSON.stringify({ part }) }),
  // LIVE-VIEW-01: open and close the hub's live view of one robot's camera. `stream` is the
  // hub's own multipart JPEG route; the browser shows it in an image and closing it stops the view.
  startRobotLiveView: (id: string) =>
    request<{ view_id: string; stream: string }>(`/api/devices/${encodeURIComponent(id)}/live-view`, { method: "POST" }),
  stopRobotLiveView: (viewId: string) =>
    request<unknown>(`/api/devices/live-view/${encodeURIComponent(viewId)}`, { method: "DELETE" }),
  approveRobotCode: (code: string, totpToken?: string) =>
    request<{ success: true }>("/api/auth/quick-connect/approve", {
      method: "POST",
      body: JSON.stringify({ code, totpToken }),
    }),
  // ROBOT-DEVICE-01: a separate step from pairing - rotates a paired
  // robot's SSH password off the vendor's published default, which this
  // hub never stores or guesses, only the admin typing it here does.
  // currentPassword is optional now (a code review, 2026-09-27): the
  // server tries this device's own stored credential, then the most
  // recent one rotated at this same host, before ever needing it -
  // "Rotate again" and re-pairing a previously-known unit both need no
  // typing at all. An empty field is omitted entirely rather than sent
  // as "", which the backend's schema would reject as too short.
  rotateRobotPassword: (deviceId: string, host: string, currentPassword?: string) =>
    request<{ success: true; rotatedAt: string }>(`/api/devices/${encodeURIComponent(deviceId)}/rotate-robot-password`, {
      method: "POST",
      body: JSON.stringify({ host, currentPassword: currentPassword || undefined }),
    }),
  robotPasswordStatus: (deviceId: string) =>
    request<{ rotated: boolean }>(`/api/devices/${encodeURIComponent(deviceId)}/robot-password-status`),
  engineLinkCredentialStatus: () => request<{ paired: boolean }>("/api/engine-link/credentials"),
  issueEngineLinkPairing: () => request<{ code: string; expires_at: string }>("/api/engine-link/pair", { method: "POST" }),
  scanEngineLinkHostKey: () => request<{ scanned: true }>("/api/engine-link/host-key/scan", { method: "POST" }),
  confirmEngineLinkHostKey: (check_code: string) => request<{ paired: boolean }>("/api/engine-link/host-key/confirm", { method: "POST", body: JSON.stringify({ check_code }) }),
  revokeEngineLink: () => request<{ paired: false }>("/api/engine-link/credentials", { method: "DELETE" }),
  sessions: () => request<SessionInfo[]>("/api/auth/sessions"),
  awaySessions: () => request<SessionInfo[]>("/api/auth/sessions/away"),
  revokeSession: (id: string) =>
    request<{ success: true }>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // GET /api/conversations/turns, not the bare /api/conversations - a
  // real, LIVE bug fixed here (backend/src/routes/conversations.ts's own
  // comment already named it): session A step 3 repointed GET
  // /api/conversations itself to the new ConversationSummary[] listing
  // shape and moved the old flat-turn-list behavior to /turns, but this
  // call (and chatHistoryAdapter.ts's own ConversationTurnRow-shaped
  // read of it) was never updated - every Chat page load was fetching
  // the wrong shape and rendering undefined user/assistant text.
  conversations: () => request<ConversationTurnWithMemoryIds[]>("/api/conversations/turns"),
  // GET /api/conversations' real, current shape (the thread list) -
  // `person` for the parental view (an owner/admin listing a child's own
  // threads; the route's own list() enforces that access check server-
  // side and returns an empty list for anyone it denies, never a 403).
  conversationList: (person?: string, query?: string, archived?: "include" | "only", placement?: "side" | "all") => {
    const params = new URLSearchParams();
    if (person) params.set("person", person);
    if (query) params.set("q", query);
    if (archived) params.set("archived", archived);
    if (placement) params.set("placement", placement);
    const suffix = params.toString();
    return request<ConversationSummary[]>(`/api/conversations${suffix ? `?${suffix}` : ""}`);
  },
  incognitoConversationList: (person?: string) => {
    const suffix = person ? `?person=${encodeURIComponent(person)}` : "";
    return request<ConversationSummary[]>(`/api/conversations/incognito${suffix}`);
  },
  discardIncognitoConversations: (person?: string) => {
    const suffix = person ? `?person=${encodeURIComponent(person)}` : "";
    return request<{ discarded: number }>(`/api/conversations/incognito/discard${suffix}`, { method: "POST" });
  },
  // PROJECTS-01a: `folderId` starts the chat inside one of the person's projects.
  createConversation: (mode?: Conversation["mode"], carryFrom?: string, folderId?: string, companionId?: string, placement?: "chat" | "side") => request<Conversation>("/api/conversations", { method: "POST", body: JSON.stringify({ surface: "chat", ...(placement ? { placement } : {}), ...(mode ? { mode } : {}), ...(carryFrom ? { carry_from: carryFrom } : {}), ...(folderId ? { folder_id: folderId } : {}), ...(companionId ? { companion_id: companionId } : {}) }) }),
  // PROJECTS-01a: a person's projects (chat folders) in the chat column.
  chatFolders: (person?: string, options?: { scope?: "mine" | "shared" | "all"; sort?: "order" | "updated" }) => {
    const params = new URLSearchParams();
    if (person) params.set("person", person);
    if (options?.scope) params.set("scope", options.scope);
    if (options?.sort) params.set("sort", options.sort);
    const query = params.toString();
    return request<ChatFolderView[]>(`/api/chat-folders${query ? `?${query}` : ""}`);
  },
  chatFolder: (id: string) => request<ChatFolderView>(`/api/chat-folders/${encodeURIComponent(id)}`),
  createChatProject: (input: { name: string; icon?: string; color?: string; description?: string; instructions?: string }) =>
    request<ChatFolderView>("/api/chat-folders", { method: "POST", body: JSON.stringify(input) }),
  createChatFolder: (name: string, person?: string) =>
    request<ChatFolderView>("/api/chat-folders", { method: "POST", body: JSON.stringify({ name, ...(person ? { person } : {}) }) }),
  renameChatFolder: (id: string, name: string) =>
    request<ChatFolderView>(`/api/chat-folders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  updateChatFolder: (id: string, patch: ChatFolderPatch) =>
    request<ChatFolderView>(`/api/chat-folders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteChatFolder: (id: string) => request<{ ok: true; chats_kept: number }>(`/api/chat-folders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setConversationFolder: (id: string, folderId: string | null) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ folder_id: folderId }) }),
  setConversationCompanion: (id: string, companionId: string | null) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ companion_id: companionId }) }),
  setConversationPlacement: (id: string, placement: "chat" | "side") =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ placement }) }),
  resumeConversation: (id: string) => request<Conversation>(`/api/conversations/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  conversation: (id: string) => request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`),
  setConversationSettings: (id: string, settings: Record<string, unknown>) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ settings }),
    }),
  conversationTurns: (id: string) => request<ConversationTurnWithMemoryIds[]>(`/api/conversations/${encodeURIComponent(id)}/turns`),
  chooseConversationTurn: (id: string) =>
    request<{ turn_id: string; parent_turn_id: string | null; branch_chosen: boolean }>(`/api/conversations/turns/${encodeURIComponent(id)}/choose`, { method: "POST" }),
  forkConversationTurn: (id: string) => request<Conversation>(`/api/conversations/turns/${encodeURIComponent(id)}/fork`, { method: "POST" }),
  conversationTurnDocument: (id: string) => request<TurnArtifact>(`/api/conversations/turns/${encodeURIComponent(id)}/document`),
  // SHELL-02 slice 4: always the CURRENT version of whichever artifact
  // this id belongs to (routes/artifacts.ts's own /current, resolved
  // server-side through the Home-internal artifactKey the frontend
  // never sees) - canvas-split.tsx's own acceptance ("a later turn's
  // update to the same artifact id replaces the pane's content")
  // needs this, not the bare per-version GET.
  artifactCurrent: (id: string) => request<Artifact>(`/api/artifacts/${encodeURIComponent(id)}/current`),
  // PROJECT-PROGRESS-01: the `project` reserved tool-call part
  // (ChatPage.tsx) polls this - the stored plan, each step's own
  // state, and (once posted) the finished artifact's id/version, so the
  // live card can show it without a reload (routes/projects.ts's own
  // `posted_artifact` sibling field).
  project: (id: string) => request<ProjectView>(`/api/projects/${encodeURIComponent(id)}`),
  cancelProject: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  conversationFeedback: (id: string) => request<ReplyFeedback | null>(`/api/conversations/turns/${encodeURIComponent(id)}/feedback`),
  submitConversationFeedback: (id: string, verdict: ReplyFeedback["verdict"], reason: ReplyFeedback["reason"] = null, details?: { reasons: NonNullable<ReplyFeedback["reasons"]>; note: string | null }) =>
    request<ReplyFeedback>(`/api/conversations/turns/${encodeURIComponent(id)}/feedback`, {
      method: "POST",
      body: JSON.stringify(details ? { verdict, reason, reasons: details.reasons, note: details.note } : { verdict, reason }),
    }),
  // FEEDBACK-CANCEL-01: tapping the lit thumb again takes the rating back.
  clearConversationFeedback: (id: string) =>
    request<null>(`/api/conversations/turns/${encodeURIComponent(id)}/feedback`, { method: "DELETE" }),
  followUpSuggestions: (id: string, signal?: AbortSignal) =>
    request<{ kind?: "answers" | "followups"; suggestions: { prompt: string }[] }>(`/api/conversations/turns/${encodeURIComponent(id)}/follow-up-suggestions`, { method: "POST", signal }),
  renameConversation: (id: string, title: string | null, pinned?: boolean) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title, ...(pinned === undefined ? {} : { pinned }) }),
    }),
  // No `title` in the body at all, not `title: undefined` - the PATCH
  // route reads `body.title === undefined` as "leave it alone"
  // (conversationHistory.ts's own updateConversationTitle()); a JSON
  // body with an explicit `title` key set to anything, even `undefined`
  // stringified away, is indistinguishable from omitting the key once
  // serialized, but writing the request this way (its own body shape,
  // not a call to renameConversation with a title it would have to
  // track and resend) keeps a pin toggle from ever needing the
  // conversation's own current title just to leave it untouched.
  setConversationPinned: (id: string, pinned: boolean) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
  // CONV-ARCHIVE-01: shelve or restore; the body names only `archived`, so title and pin are untouched.
  setConversationArchived: (id: string, archived: boolean) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    }),
  setConversationMode: (id: string, mode: Conversation["mode"]) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }),
  deleteConversation: (id: string, opts: { media?: boolean } = {}) =>
    request<{ ok: true }>(`/api/conversations/${encodeURIComponent(id)}${opts.media ? "?media=1" : ""}`, { method: "DELETE" }),
  conversationMediaCount: (id: string) => request<{ images: number; videos: number }>(`/api/conversations/${encodeURIComponent(id)}/media-count`),
  batchDeleteConversations: (ids: string[]) =>
    request<{ deleted: number }>("/api/conversations/batch-delete", { method: "POST", body: JSON.stringify({ ids }) }),
  clearConversations: () => request<{ deleted: number }>("/api/conversations/clear", { method: "POST" }),
  // SHELL-SEARCH-02: the shape (`{groups: SearchGroup[]}`) matches
  // `@maipai/ui`'s own `HeaderSearch` `remote` prop exactly (`SearchGroup`
  // imported, never redeclared) - `groups` from GET /api/search is
  // passed straight through, the kit's own render composing every
  // result into a real command item.
  search: (q: string) => request<{ groups: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.groups),
  settingsRegistry: () => request<SettingsKey[]>("/api/settings/registry"),
  settingsCapabilities: () => request<{ robotsEnabled: boolean }>("/api/settings/capabilities"),
  codingAccess: () => request<{ allowed: boolean; can_create: boolean }>("/api/settings/coding-access"),
  codingPieces: () => request<CodingPiecesView>("/api/coding/pieces"),
  codingMode: () => request<CodingModeView>("/api/coding/mode"),
  runCodingModeSelfTest: () => request<unknown>("/api/coding/mode/self-test", { method: "POST" }),
  setupCoding: () => request<SetupCodingView>("/api/setup/coding"),
  chooseSetupCoding: (choice: "set_up" | "later") => request<SetupCodingView>("/api/setup/coding", { method: "POST", body: JSON.stringify({ choice }) }),
  installCodingPiece: (id: CodingPiece["id"]) => request<{ job: string | null; piece: CodingPiece["id"] }>(`/api/coding/pieces/${id}/install`, { method: "POST" }),
  removeCodingPiece: (id: CodingPiece["id"]) => request<{ piece: CodingPiece["id"]; removed: true }>(`/api/coding/pieces/${id}`, { method: "DELETE" }),
  apiKeys: () => request<{ keys: PersonalApiKey[] }>("/api/settings/api-keys"),
  createApiKey: (input: { name: string; scopes: Array<"turn" | "code" | "settings" | "diagnose" | "engine">; expires_in_days: 7 | 30 | 90 | 365 }) =>
    request<{ key: PersonalApiKey; secret: string }>("/api/settings/api-keys", { method: "POST", body: JSON.stringify(input) }),
  renameApiKey: (id: string, name: string) => request<{ success: true }>(`/api/settings/api-keys/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  revokeApiKey: (id: string) => request<{ success: true }>(`/api/settings/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminApiKeys: (personId: string) => request<{ keys: AdminApiKey[] }>(`/api/settings/api-keys/people/${encodeURIComponent(personId)}`),
  adminRevokeApiKey: (personId: string, id: string) => request<{ success: true }>(`/api/settings/api-keys/people/${encodeURIComponent(personId)}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminRevokeAllApiKeys: (personId: string) => request<{ revoked: number }>(`/api/settings/api-keys/people/${encodeURIComponent(personId)}`, { method: "DELETE" }),
  grants: (personId?: string) => request<CodingGrant[]>(`/api/grants${personId ? `?person=${encodeURIComponent(personId)}` : ""}`),
  createGrant: (input: { person: string; action: string; effect: "allow" | "deny" }) => request<CodingGrant>("/api/grants", { method: "POST", body: JSON.stringify(input) }),
  revokeGrant: (id: string) => request<{ id: string }>(`/api/grants/${encodeURIComponent(id)}`, { method: "DELETE" }),
  wakewordStatus: () => request<{ detectors: { id: string; label: string; file: string }[]; installed: boolean }>("/api/voice/wakewords"),
  settingsValues: (scope: string, key?: string) =>
    request<ResolvedSetting[]>(`/api/settings?scope=${encodeURIComponent(scope)}${key ? `&key=${encodeURIComponent(key)}` : ""}`),
  emergencyKit: () => request<{ hubName: string; hubInstanceId: string; backupKeyHex: string; generatedAt: string }>("/api/backups/emergency-kit"),
  setSetting: (scope: string, key: string, value: unknown, confirmRemoval?: boolean) =>
    request<ResolvedSetting>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ scope, key, value, ...(confirmRemoval ? { confirmRemoval } : {}) }),
    }),
  stackVoices: () => request<{ voices: StackVoice[] }>("/api/voice/voices"),
  // Dedicated routes, not the generic setSetting/resetSetting: saving or
  // removing voice.hf_token updates the Stack speech service (see
  // routes/voice.ts's own comment on why the generic PUT route has no
  // hook for that).
  setHfToken: (token: string) =>
    request<ResolvedSetting>("/api/voice/hf-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  removeHfToken: () => request<ResolvedSetting>("/api/voice/hf-token/remove", { method: "POST" }),
  resetSetting: (scope: string, key: string) =>
    request<ResolvedSetting>("/api/settings/reset", {
      method: "POST",
      body: JSON.stringify({ scope, key }),
    }),
  people: () => request<PersonRosterEntry[]>("/api/people"),
  // SETTINGS-LAYERS-01d: a person's blocked-site categories as two columns (global defaults, user overrides).
  siteBlocks: (id: string) => request<SiteBlocksView>(`/api/people/${encodeURIComponent(id)}/site-blocks`),
  setSiteBlock: (id: string, item: string, checked: boolean) =>
    request<SiteBlocksView>(`/api/people/${encodeURIComponent(id)}/site-blocks`, { method: "PUT", body: JSON.stringify({ id: item, checked }) }),
  resetSiteBlocks: (id: string, item?: string) =>
    request<SiteBlocksView>(`/api/people/${encodeURIComponent(id)}/site-blocks/reset`, { method: "POST", body: JSON.stringify(item ? { id: item } : {}) }),
  // GET /api/dashboard (SHELL-01): every signed-in person's own
  // household glanceable state; repairs_open/engines are additive
  // fields present only for owner/admin (absent, not null/zero, for
  // anyone else - backend/src/lib/dashboard.ts's own header).
  dashboard: () => request<Dashboard>("/api/dashboard"),
  setupChecklist: () => request<SetupChecklistItem[]>("/api/setup-checklist"),
  // GET /api/engines, GET /api/engines/health (SHELL-06, HOME-STACK-04a):
  // owner/admin only. `configured: false` (empty roles/engines, null
  // budget or an empty health list) is a normal, common household state
  // (no Stack set up), never an error - routes/engines.ts's own header.
  engines: () => request<EnginesOverview>("/api/engines"),
  engineConnectionCheck: () => request<{ hops: Array<{ id: number; pass: boolean; detail?: string; fix: string }> }>("/api/engines/connection-check", { method: "POST" }),
  enginesHealth: () => request<EnginesHealth>("/api/engines/health"),
  // GET /api/voice/stt/status (DICT-01): whether the STT assets (Silero
  // VAD, Moonshine) are installed and the recognizer is loaded - the
  // composer's mic button checks this before opening a session, never
  // after a silently dead click.
  sttStatus: () => request<SttStatusResponse>("/api/voice/stt/status"),
  // GET /api/performance (ADMIN-PERF-01): owner/admin only, one
  // aggregate read of turn stats, queues, the label harvest, engine
  // health and hardware. `days` defaults to 30 on the backend when
  // omitted.
  performance: (days?: number) => request<Performance>(`/api/performance${days ? `?days=${days}` : ""}`),
  // GET /api/turn-error-detail/:id (THIN-1E): owner/admin only, the stored raw detail of a failed turn.
  turnErrorDetail: (turnId: string) => request<TurnErrorDetail>(`/api/turn-error-detail/${encodeURIComponent(turnId)}`),
  turnTrace: (turnId: string) => request<{ spans: { id: string; name: string; depth: number; startMs: number; durationMs: number; status: "running" | "completed" | "failed" | "skipped"; error_code?: string }[]; totalMs: number; visibleCount: number }>(`/api/admin/turns/${encodeURIComponent(turnId)}/trace`),
  // GET /api/storage/usage (STORE-PAGE-01): every signed-in person may
  // call this - an owner/admin gets every person's row plus the
  // household total, anyone else gets a single row (themself) and a
  // null household. The row-visibility rule lives on the backend
  // (storageUsageOverview()), not re-applied here.
  storageUsage: () => request<StorageUsageOverview>("/api/storage/usage"),
  packageCacheSources: () => request<PackageCacheSourceRow[]>("/api/storage/package-cache"),
  clearPackageCache: (source?: string) => request<{ removed: number; bytes: number }>("/api/storage/package-cache/clear", {
    method: "POST",
    body: JSON.stringify(source === undefined ? {} : { source }),
  }),
  createPerson: (input: { displayName: string; role: Role; secret?: string }) =>
    request<PersonRosterEntry>("/api/people", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  backups: () => request<BackupInfo[]>("/api/backups"),
  runBackup: () => request<BackupInfo>("/api/backups/run", { method: "POST" }),
  // The plan's own "count fall-throughs... and decide on tier 2 from the
  // eval number" measurement (4.5), owner/admin only - aggregate counts,
  // not any one person's conversation content.
  routingStats: () => request<RoutingStats>("/api/plugins/stats"),
  pendingRestore: () => request<{ pending: PendingRestore | null }>("/api/backups/restore/pending"),
  stageRestore: (filename: string) =>
    request<{ pending: PendingRestore }>(`/api/backups/${encodeURIComponent(filename)}/restore`, { method: "POST" }),
  cancelRestore: () => request<{ cancelled: boolean }>("/api/backups/restore/cancel", { method: "POST" }),
  updatePerson: (
    id: string,
    edit: {
      displayName?: string;
      nickname?: string | null;
      // PEOPLE-PROFILE-01: the profile page's own Edit dialog.
      bio?: string | null;
      accent?: Person["accent"];
      role?: string;
      sessionLockRequired?: boolean;
      sessionLockTimeoutMinutes?: number;
    },
  ) =>
    request<PersonRosterEntry>(`/api/people/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(edit),
    }),
  // STORE-DELETE-01: read by the delete confirmation, so the export is
  // offered before a person's files are purged (decision 5).
  personDeletionPreview: (id: string) =>
    request<PersonDeletionPreview>(`/api/people/${encodeURIComponent(id)}/deletion-preview`),
  deletePerson: (id: string) =>
    request<{ erased: Record<string, number> }>(`/api/people/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deletePeople: (ids: string[]) =>
    request<{ outcomes: Array<{ id: string; deleted: boolean; reason?: string }> }>("/api/people/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  privacy: () => request<{ connections: PrivacyConnection[]; offlinePlugins: string[] }>("/api/privacy"),
  commands: () => request<CommandRow[]>("/api/commands"),
  createCommand: (input: { trigger: string; minRole: string; action: CommandAction }) =>
    request<CommandRow>("/api/commands", { method: "POST", body: JSON.stringify(input) }),
  deleteCommand: (id: string) =>
    request<{ id: string }>(`/api/commands/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Lane 11 item 2: "anything the household knows about" (routes/entities.ts,
  // relationships.ts) - the household-scoped list plus this actor's own
  // person-scoped rows, exactly what GET /api/entities and /api/relationships
  // already return; no client-side re-filtering.
  entities: (kind?: string) => request<Entity[]>(`/api/entities${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`),
  createEntity: (input: {
    kind: "person" | "pet" | "place" | "organization" | "thing";
    name: string;
    place_kind?: "map" | "area" | null;
    scope?: "household" | "person";
    account_person_id?: string | null;
    geo?: Entity["geo"];
  }) => request<Entity>("/api/entities", { method: "POST", body: JSON.stringify(input) }),
  // PLACE-ELEMENT-01a: geocoding candidates for the location field's search.
  searchPlaces: (q: string) =>
    request<Array<{ name: string; area: string | null; lat: number; lon: number }>>(`/api/places/search?q=${encodeURIComponent(q)}`),
  // WEATHER-HOME-ASK-01: offline city lookup and nearest city for a point; nothing leaves the home.
  localSearchPlaces: (q: string) =>
    request<Array<{ name: string; area: string | null; lat: number; lon: number; country: string; zone: string }>>(`/api/places/local-search?q=${encodeURIComponent(q)}`),
  nearestPlace: (lat: number, lon: number) =>
    request<{ name: string; area: string | null; lat: number; lon: number } | null>(`/api/places/nearest?lat=${lat}&lon=${lon}`),
  // kind is deliberately not editable (backend/src/lib/entities.ts's own
  // updateEntity() comment: "set once at creation and never move
  // afterward... a household that got a kind wrong deletes the entity
  // and makes a new one" - a real design invariant, not a gap).
  updateEntity: (id: string, edit: { name?: string }) =>
    request<Entity>(`/api/entities/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(edit) }),
  deleteEntity: (id: string) => request<{ id: string }>(`/api/entities/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // home#119, the entity half of confirmRelationship() below: the one
  // way an inferred entity's confirmed_by_person_id/confirmed_at ever
  // get set (backend/src/lib/entities.ts's confirmTransition(), step
  // 3a). Sends exactly this body and nothing else - PATCH
  // /api/entities/:id's schema is `.strict()`, and confirm alongside
  // any other edit field would stop being the adult-open path.
  confirmEntity: (id: string) =>
    request<Entity>(`/api/entities/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ confirm: true }) }),
  relationships: () => request<Relationship[]>("/api/relationships"),
  createRelationship: (input: { type: string; from_id: string; to_id: string; scope?: "household" | "person" }) =>
    request<Relationship>("/api/relationships", { method: "POST", body: JSON.stringify(input) }),
  deleteRelationship: (id: string) => request<{ id: string }>(`/api/relationships/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Lane 12 item 2: the one way an inferred relationship's
  // confirmed_by_person_id/confirmed_at ever get set (backend/src/lib/
  // entities.ts's confirmTransition(), step 3a) - a household adult
  // vouching for a guess the judge made. Sends exactly this body and
  // nothing else: PATCH /api/relationships/:id's own schema is `.strict()`,
  // and a confirm alongside any other edit field would stop being the
  // adult-open "confirming is the person's own record" path and need
  // owner/admin instead (relationships.ts's own confirmOnly check).
  confirmRelationship: (id: string) =>
    request<Relationship>(`/api/relationships/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ confirm: true }) }),
  notifications: () => request<NotificationDeliveryView[]>("/api/notifications"),
  // ACTIVITY-01d: the Running now panel. One list per viewer (the service
  // already filters by age band); stop, approve and deny act on one row.
  jobs: () => request<HomeJobView[]>("/api/jobs"),
  stopJob: (id: string) => request<{ ok: true }>(`/api/jobs/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  decideApproval: (id: string, decision: "approve" | "deny") =>
    request<{ id: string }>(`/api/approvals/${encodeURIComponent(id)}/${decision}`, { method: "POST" }),
  notificationHistory: () => request<NotificationDeliveryView[]>("/api/notifications/history"),
  markNotificationRead: (id: string) =>
    request<NotificationDeliveryView>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  dismissNotification: (id: string) =>
    request<{ id: string }>(`/api/notifications/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
  // Lane 15: the bell popover's "Dismiss all", and the history page's
  // own "Clear all"/"Dismiss selected" - one real route
  // (POST /api/notifications/dismiss) instead of a client-side loop
  // over dismissNotification() above, which stays for a single item.
  dismissNotifications: (selector: { ids: string[] } | { all: true }) =>
    request<{ count: number }>("/api/notifications/dismiss", { method: "POST", body: JSON.stringify(selector) }),
  // A 404 here means "the widgets route isn't built yet" (D's step 9,
  // not started), which reads identically to a household with no
  // widget-contributing packages installed - also true for a while
  // after the route lands - so it resolves to an empty list rather than
  // the caller's own error state. HomePage.tsx's own rule: "a failed
  // card is a quiet gap in Today, never a red error banner." Any other
  // status still throws: this only swallows "doesn't exist," never a
  // real failure once the route does exist.
  widgets: () =>
    request<WidgetDescriptor[]>("/api/widgets").catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }),
  homeWidgets: () => request<HomeWidgets>("/api/widgets/home?surface=home"),
  widgetData: (pkg: string, id: string) =>
    request<WidgetData>(`/api/widgets/${encodeURIComponent(pkg)}/${encodeURIComponent(id)}/data`).catch(
      (e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return { as_of: new Date().toISOString(), items: [] };
        throw e;
      },
    ),
  // APP-KIND-03/04: the package apps this person may open, and one of an app's page documents
  // (a spec `page`, drawn by the kit's SchemaPage). A hidden or unknown app and page are both 404.
  apps: () => request<AppRow[]>("/api/apps"),
  mediaHome: () => request<MediaHome>("/api/media/home"),
  continueRows: () => request<{ rows: Array<{ source: string; kind: "chat" | "media"; id: string; title: string; subtitle: string | null; href: string; at: string; percent: number | null; media_kind: string | null; artwork_url: string | null }> }>("/api/continue"),
  companions: () => request<CompanionList>("/api/companions"),
  companion: (id: string) => request<CompanionDetail>(`/api/companions/${encodeURIComponent(id)}`),
  companionActivity: (id: string) => request<CompanionActivity>(`/api/companions/${encodeURIComponent(id)}/activity`),
  setDefaultCompanion: (id: string) => request<{ default_id: string }>(`/api/companions/${encodeURIComponent(id)}/default`, { method: "PUT" }),
  addCompanion: (id: string) => request<{ companions: string[] }>(`/api/companions/${encodeURIComponent(id)}/add`, { method: "POST" }),
  removeCompanion: (id: string) => request<{ companions: string[] }>(`/api/companions/${encodeURIComponent(id)}/remove`, { method: "POST" }),
  createCompanion: (fields: CompanionFields) => request<{ id: string }>("/api/companions", { method: "POST", body: JSON.stringify(fields) }),
  copyCompanion: (id: string) => request<{ id: string }>(`/api/companions/${encodeURIComponent(id)}/copy`, { method: "POST", body: "{}" }),
  editCompanion: (id: string) => request<CompanionEditable>(`/api/companions/${encodeURIComponent(id)}/edit`),
  companionLook: (id: string) => request<CompanionLook>(`/api/companions/${encodeURIComponent(id)}/look`),
  companionLookPrompt: (id: string) => request<CompanionPromptPack>(`/api/companions/${encodeURIComponent(id)}/look/prompt`),
  companionStatePrompt: (id: string, state: string) => request<CompanionPromptPack>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/prompt`),
  companionStates: (id: string) => request<CompanionStates>(`/api/companions/${encodeURIComponent(id)}/states`),
  companionAppearance: (id: string) => request<CompanionAppearance>(`/api/companions/${encodeURIComponent(id)}/appearance`),
  publishCompanionAppearance: (id: string) => request<{ published: true }>(`/api/companions/${encodeURIComponent(id)}/appearance/publish`, { method: "POST" }),
  companionStateFile: (id: string, state: string, take: string, file: string) => `/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/${encodeURIComponent(take)}/${encodeURIComponent(file)}`,
  setCompanionStateMotion: (id: string, state: string, motion: string | null) => request<{ ok: boolean }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/motion`, { method: "PUT", body: JSON.stringify({ motion }) }),
  uploadCompanionState: (id: string, state: string, form: FormData) => request<{ take_id: string }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/upload`, { method: "POST", body: form }),
  companionStateJob: (id: string, take: string) => request<CompanionStateJob>(`/api/companions/${encodeURIComponent(id)}/states/jobs/${encodeURIComponent(take)}`),
  generateCompanionState: (id: string, state: string, body: { count: number; motion?: string }) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/generate`, { method: "POST", body: JSON.stringify(body) }),
  generateCompanionStates: (id: string, body: { required_only?: boolean; states?: string[]; count?: number }) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/states/generate`, { method: "POST", body: JSON.stringify(body) }),
  generateCompanionKeyframe: (id: string, state: string) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/keyframe/generate`, { method: "POST" }),
  editCompanionKeyframe: (id: string, state: string, instruction: string) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/keyframe/edit`, { method: "POST", body: JSON.stringify({ instruction }) }),
  uploadCompanionKeyframe: (id: string, state: string, form: FormData) => request<{ saved: boolean }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/keyframe`, { method: "POST", body: form }),
  prepareCompanionKeyframe: (id: string, state: string, body: { remove_background: boolean; frame?: { zoom: number; x: number; y: number } }) => request<{ saved: boolean }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/keyframe/prepare`, { method: "POST", body: JSON.stringify(body) }),
  deleteCompanionKeyframe: (id: string, state: string) => request<void>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/keyframe`, { method: "DELETE" }),
  companionStateRun: (id: string, job: string) => request<CompanionStateRun>(`/api/companions/${encodeURIComponent(id)}/states/jobs/run/${encodeURIComponent(job)}`),
  stopCompanionStateRun: (id: string, job: string) => request<void>(`/api/companions/${encodeURIComponent(id)}/states/jobs/run/${encodeURIComponent(job)}`, { method: "DELETE" }),
  approveCompanionState: (id: string, state: string, take_id: string, force?: boolean) => request<{ approved: string }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/approve`, { method: "PUT", body: JSON.stringify({ take_id, ...(force ? { force: true } : {}) }) }),
  removeCompanionStateApproval: (id: string, state: string) => request<{ ok: boolean; note?: string }>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/approve`, { method: "DELETE" }),
  deleteCompanionStateTake: (id: string, state: string, take: string) => request<void>(`/api/companions/${encodeURIComponent(id)}/states/${encodeURIComponent(state)}/${encodeURIComponent(take)}`, { method: "DELETE" }),
  companionLookImage: (id: string, versionId: string) => `/api/companions/${encodeURIComponent(id)}/look/${encodeURIComponent(versionId)}/image`,
  companionPortrait: (key: string) => {
    const [id, version, ...extra] = key.split("/");
    if (!id || !version || extra.length) throw new Error("Companion portrait key must contain an id and version. Use the saved id/version key.");
    return `/api/companions/portraits/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
  },
  uploadCompanionLook: (id: string, form: FormData) => request<{ id: string; clipped?: string[] }>(`/api/companions/${encodeURIComponent(id)}/look/upload`, { method: "POST", body: form }),
  setCompanionLookRest: (id: string, version_id: string) => request<{ rest: string; sheet_reset: boolean }>(`/api/companions/${encodeURIComponent(id)}/look/rest`, { method: "PUT", body: JSON.stringify({ version_id }) }),
  deleteCompanionLookVersion: (id: string, versionId: string) => request<void>(`/api/companions/${encodeURIComponent(id)}/look/${encodeURIComponent(versionId)}`, { method: "DELETE" }),
  generateCompanionLook: (id: string, body: { prompt?: string; style?: string; custom_style?: string; count?: number } = {}) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/look/generate`, { method: "POST", body: JSON.stringify(body) }),
  companionLookJob: (id: string, job: string) => request<CompanionLookJob>(`/api/companions/${encodeURIComponent(id)}/look/jobs/${encodeURIComponent(job)}`),
  cancelCompanionLookJob: (id: string, job: string) => request<void>(`/api/companions/${encodeURIComponent(id)}/look/jobs/${encodeURIComponent(job)}`, { method: "DELETE" }),
  /** COMPANION-3S-01: a name-only draft, made the first time the person names a character; Home returns the same draft for the same name. */
  /** The styles the viewer's age band may use, before any draft exists (screen 1 shows the tiles at once). */
  getCompanionLookStyles: () => request<{ styles: Array<{ id: string; label: string; custom?: boolean }>; keep: { id: "keep"; label: string } }>("/api/companions/look-styles"),
  /** COMPANION-3S-01 screen 3: one suggested backstory sentence from the local chat model. `hint` is the personality notes, if any. */
  generateCompanionBackstory: (id: string, body: { hint?: string } = {}) => request<{ text: string }>(`/api/companions/${encodeURIComponent(id)}/backstory/generate`, { method: "POST", body: JSON.stringify(body) }),
  /** COMPANION-3S-01 screen 3: save voice, personality and backstory, and publish the approved appearance. A 409 or 422 carries `go_back_to`. */
  saveCompanion: (id: string, body: { voice_id: string; personality: CompanionPersonality; style_notes?: string; backstory?: string }) => request<{ id: string; status: "ready"; published: boolean }>(`/api/companions/${encodeURIComponent(id)}/save`, { method: "POST", body: JSON.stringify(body) }),
  setCompanionAudience: (id: string, body: { audience: "adult" | "teen" | "all"; confirmed?: boolean }) => request<{ id: string }>(`/api/companions/${encodeURIComponent(id)}/audience`, { method: "PUT", body: JSON.stringify(body) }),
  createCompanionDraft: (name: string) => request<{ id: string }>("/api/companions/draft", { method: "POST", body: JSON.stringify({ name }) }),
  restyleCompanionLook: (id: string, body: { version_id: string; style: string; custom_style?: string }) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/look/restyle`, { method: "POST", body: JSON.stringify(body) }),
  prepareCompanionLook: (id: string, body: { version_id: string; remove_background: boolean; frame?: { zoom: number; x: number; y: number } }) => request<{ id: string; clipped?: string[] }>(`/api/companions/${encodeURIComponent(id)}/look/prepare`, { method: "POST", body: JSON.stringify(body) }),
  completeCompanionLook: (id: string, version_id: string) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/look/complete`, { method: "POST", body: JSON.stringify({ version_id }) }),
  approveCompanionLook: (id: string, version_id: string) => request<{ job: string | null }>(`/api/companions/${encodeURIComponent(id)}/look/approve`, { method: "POST", body: JSON.stringify({ version_id }) }),
  editCompanionLook: (id: string, body: { version_id: string; instruction: string }) => request<{ job: string }>(`/api/companions/${encodeURIComponent(id)}/look/edit`, { method: "POST", body: JSON.stringify(body) }),
  makeCompanionLookSheet: (id: string) => request<{ job: string; card_source: "model" | "look_prompt" }>(`/api/companions/${encodeURIComponent(id)}/look/sheet`, { method: "POST" }),
  saveCompanionLookCard: (id: string, body: { text: string; species?: string }) => request<{ card: CompanionLookSheet["card"] }>(`/api/companions/${encodeURIComponent(id)}/look/sheet/card`, { method: "PUT", body: JSON.stringify(body) }),
  setCompanionLookKey: (id: string, key: CompanionLookKey) => request<{ key: CompanionLookKey }>(`/api/companions/${encodeURIComponent(id)}/look/sheet/key`, { method: "PUT", body: JSON.stringify({ key }) }),
  approveCompanionLookSheet: (id: string) => request<{ sheet: CompanionLookSheet }>(`/api/companions/${encodeURIComponent(id)}/look/sheet/approve`, { method: "POST" }),
  unapproveCompanionLookSheet: (id: string) => request<{ sheet: CompanionLookSheet }>(`/api/companions/${encodeURIComponent(id)}/look/sheet/unapprove`, { method: "POST" }),
  updateCompanion: (id: string, fields: CompanionFields) => request<{ id: string }>(`/api/companions/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(fields) }),
  setCompanionStatus: (id: string, status: "draft" | "ready") => request<{ id: string }>(`/api/companions/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  deleteCompanion: (id: string) => request<void>(`/api/companions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  mediaSearch: (q: string) => request<MediaSearch>(`/api/media/search?q=${encodeURIComponent(q)}`),
  // MEDIA-VIDEOS-01: one data id of a package app (POST /api/plugins/:id/data/:dataId), and one media item's record (the owning app of a
  // `/media/<id>` link is read from its kind).
  appData: <T>(pkg: string, dataId: string, body: Record<string, unknown> = {}) =>
    request<T>(`/api/plugins/${encodeURIComponent(pkg)}/data/${encodeURIComponent(dataId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  mediaItem: (id: string) => request<{ item: { id: string; kind: string; title: string } }>(`/api/media/items/${encodeURIComponent(id)}`),
  // MEDIA-POLISH-01: the docked mini bar's progress report (POST /api/plugins/:id/progress, the media app host's own action).
  mediaProgress: (pkg: string, body: { media_id: string; position_s?: number; duration_s?: number; reason: string; locator?: unknown; percent?: number }, keepalive = false) =>
    request<{ ok: true }>(`/api/plugins/${encodeURIComponent(pkg)}/progress`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive }),
  appPage: (pkg: string, page: string) => request<unknown>(`/api/plugins/${encodeURIComponent(pkg)}/pages/${encodeURIComponent(page)}`),
  // GET /api/repairs (backend/src/routes/repairs.ts): real and fully
  // landed (F step 1), unlike widgets/lists above - no graceful-404
  // handling needed, a failure here is a real failure.
  repairs: () => request<Issue[]>("/api/repairs"),
  // fixIssue() really does return the updated Issue (backend/src/lib/
  // issues.ts's fixIssue()); dismissIssue() returns only `{id}`
  // (dismissIssue()'s own return type) - a code review, 2026-09-06,
  // caught this file originally typing both as `Issue`, which
  // type-checked but would hand a future caller `undefined` for every
  // field but `id`.
  fixIssue: (id: string) => request<Issue>(`/api/repairs/${encodeURIComponent(id)}/fix`, { method: "POST" }),
  dismissIssue: (id: string) => request<{ id: string }>(`/api/repairs/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
  // GET /api/updates (backend/src/routes/updates.ts): app, configured
  // Stack, and installed reference-set updates. checkForUpdate() forces
  // a fresh GitHub check for the app only; owner/admin (or a
  // backups.run grant) only, the route's own 403 on anyone else.
  updates: () => request<UpdateProjection>("/api/updates"),
  checkForUpdate: () => request<AppUpdateProjection>("/api/updates/check", { method: "POST" }),
  // HOME-STACK-05: the Stack's own maintenance actions - each a real
  // network call through the Stack, owner/admin (or backups.run) only,
  // same as checkForUpdate() above.
  checkStackUpdates: () => request<StackUpdatesProjection>("/api/updates/stack/check", { method: "POST" }),
  applyStackEngineUpdate: (name: string) => request<{ applied: boolean; tag: string | null; previous: string | null }>(`/api/updates/stack/engines/${encodeURIComponent(name)}/apply`, { method: "POST" }),
  rollbackStackEngine: (name: string, tag: string) => request<{ ok: true; tag: string }>(`/api/updates/stack/engines/${encodeURIComponent(name)}/rollback`, { method: "POST", body: JSON.stringify({ tag }) }),
  engineAction: (name: string, action: "start" | "stop" | "restart" | "install") => request<Record<string, unknown>>(`/api/engines/${encodeURIComponent(name)}/${action}`, { method: "POST" }),
  sweepStackStorage: () => request<{ removed: string[] }>("/api/updates/stack/sweep", { method: "POST" }),
  runStackReadinessCheck: () => request<{ at: string; ok: boolean; reason: string | null }>("/api/updates/stack/readiness-check", { method: "POST" }),
  // `person`, for the per-person view an adult opens for a child
  // (session E step 5): GET /api/memory's own `?person=` (backend/src/
  // routes/memory.ts's parseListOptions) - the same real access check
  // (assertCanForgetOrExport-adjacent) every other per-person read in
  // this app already relies on server-side, not re-implemented here.
  memories: (personId?: string) =>
    request<MemoryRecordWithDevice[]>(`/api/memory${personId ? `?person=${encodeURIComponent(personId)}` : ""}`),
  forgetPersonMemories: (personId: string) =>
    request<{ deleted: number }>("/api/memory/forget", { method: "POST", body: JSON.stringify({ personId }) }),
  // Distinct from forgetPersonMemories above (that erases every record
  // for ONE person): MemoryPage.tsx's own "forget selected"/"clear all"
  // over a caller-chosen set of ids, one round trip regardless of count.
  batchForgetMemories: (ids: string[]) =>
    request<{ outcomes: Array<{ id: string; deleted: boolean; reason?: string }> }>("/api/memory/batch-forget", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  exportPersonMemories: (personId: string) =>
    request<MemoryRecord[]>(`/api/memory/export?personId=${encodeURIComponent(personId)}`),
  archiveMemory: (id: string) =>
    request<MemoryRecord>(`/api/memory/${encodeURIComponent(id)}/archive`, { method: "POST" }),
  setAudience: (id: string, childDisclosure: "child_ok" | "teen_ok" | "adult_only") =>
    request<MemoryRecord>(`/api/memory/${encodeURIComponent(id)}/audience`, {
      method: "POST",
      body: JSON.stringify({ child_disclosure: childDisclosure }),
    }),
  // POST /api/memory (backend/src/lib/memory.ts's remember(), already on
  // main) backs the chat "remember this" action (step 4). Its real input
  // type (RememberInput) lives in backend/src/wire.ts, a file Session A
  // owns (docs/plans/session-a-intelligence.md's "Files you own") - this
  // repeats only the fields "remember this" actually sends, rather than
  // touching that file to export one more type.
  remember: (input: {
    text: string;
    category: MemoryRecord["category"];
    tier: MemoryRecord["tier"];
    scope: MemoryRecord["scope"];
    person?: string | null;
    /** ELEMENTS-ADOPT-02: the person's own saved turn this memory came
     * from; the hub verifies it and records it as the source. */
    turn_id?: string;
    importance: number;
  }) => request<MemoryRecord>("/api/memory", { method: "POST", body: JSON.stringify(input) }),
  // GET /api/plugins (already on main): every installed package's
  // manifest, `routing.examples` included - the chat composer's empty-
  // state suggested prompts (step 4) are drawn from these rather than
  // invented, so they're always real things MaiPai can actually do.
  plugins: () => request<InstalledPackage[]>("/api/plugins"),
  tourProgress: () => request<TourProgressRecord[]>("/api/tours/progress"),
  saveTourProgress: (record: Pick<TourProgressRecord, "tour_id" | "package_id" | "version" | "status" | "step_reached">) =>
    request<TourProgressRecord>("/api/tours/progress", { method: "POST", body: JSON.stringify(record) }),
  countMissingTourTarget: (record: { tour_id: string; package_id: string; step_id: string }) =>
    request<{ success: true }>("/api/tours/missing-target", { method: "POST", body: JSON.stringify(record) }),
  missingTourTargets: () => request<Array<{ key: string; count: number }>>("/api/tours/missing-targets"),
  // SKILLS-PAGE-01: every installed plugin, skill and project package this
  // person may use, with whether their written chat offers it today.
  skills: () => request<SkillRow[]>("/api/plugins/skills"),
  // STORE-SHARE-01: my own Library - files I own, plus files shared with
  // me, each listed once under its real owner (owner_person_id), never
  // the recipient - a shared file's usage counts against the owner only.
  // PEOPLE-PROFILE-02: an optional `ownerId` narrows the same list to
  // one person's own files (still filtered to what I may see) - the
  // profile page's shared-media grid, reusing this one route rather
  // than a second listing endpoint.
  library: (query: LibraryQuery = {}) => request<{ items: LibraryItem[]; next_cursor: string | null }>(`/api/library?${libraryParams({ limit: 60, ...query })}`),
  librarySummary: (query: LibraryQuery = {}) => {
    const filters: LibraryQuery = { ...query };
    delete filters.cursor;
    delete filters.limit;
    delete filters.sort;
    return request<LibrarySummary>(`/api/library/summary?${libraryParams(filters)}`);
  },
  libraryFile: (id: string) => request<FileRecordWithChat>(`/api/files/${encodeURIComponent(id)}`),
  updateLibraryFile: (id: string, change: { name?: string | null; keep?: boolean }) => request<{ id: string; name: string | null; retention: string }>(`/api/files/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(change) }),
  trashLibraryFile: (id: string) => request<{ id: string; deleted_at: string; trash_until: string }>(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
  recheckLibraryAudience: (id: string) => request<{ audience: "all-ages" }>(`/api/files/${encodeURIComponent(id)}/recheck-audience`, { method: "POST" }),
  libraryTrash: () => request<{ rows: LibraryTrashItem[] }>("/api/trash"),
  restoreLibraryFile: (id: string) => request<{ success: boolean }>(`/api/trash/file/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  purgeLibraryFile: (id: string) => request<{ success: boolean }>(`/api/trash/file/${encodeURIComponent(id)}`, { method: "DELETE" }),
  files: (ownerId?: string) => request<VisibleFile[]>(`/api/files${ownerId ? `?owner=${encodeURIComponent(ownerId)}` : ""}`),
  fileShares: (fileId: string) => request<Share[]>(`/api/files/${encodeURIComponent(fileId)}/shares`),
  // Not a fetch - just the path a real <img>/<video> element loads
  // directly (same-origin, cookie auth, no separate round trip through
  // request<T>()'s JSON parsing). Gated server-side by the same
  // canAccessFile boundary as everything else in @/lib/shares.ts.
  fileContentUrl: (fileId: string) => `/api/files/${encodeURIComponent(fileId)}/content`,
  shareFile: (fileId: string, to: string) => request<Share>(`/api/files/${encodeURIComponent(fileId)}/shares`, { method: "POST", body: JSON.stringify({ to }) }),
  unshare: (shareId: string) => request<{ deletedShareIds: string[] }>(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" }),
  // FACE-02: the guided camera-capture enrollment flow. One row per
  // accepted sample (FACE-01's own design, biometricPrints.ts's header) -
  // the enrollment page saves the whole set through enrollBiometricPrints (FACE-02Q).
  visionModels: () => request<{ detectors: VisionModelInfo[]; installed: boolean }>("/api/vision/models"),
  biometricPrints: (personId: string) => request<BiometricPrintSummary[]>(`/api/biometric-prints?personId=${encodeURIComponent(personId)}`),
  // `signal` (found by review, 2026-09-29): a cancel mid-submission has
  // to actually abort the in-flight fetch, not just stop the NEXT one -
  // request()'s own init already passes a caller-supplied signal through
  // untouched (its own comment on that line), so this only needed to
  // accept and forward one.
  createBiometricPrint: (input: { person_id: string; model_id: string; embedding: number[]; captured_by?: string | null }, signal?: AbortSignal) =>
    request<BiometricPrintSummary>("/api/biometric-prints", { method: "POST", body: JSON.stringify(input), signal }),
  // FACE-02Q (#201): a whole enrollment in one request. The hub saves every
  // sample and replaces the person's previous face set in one transaction,
  // so it is all or nothing (an error means nothing was saved).
  enrollBiometricPrints: (input: { person_id: string; model_id: string; samples: Array<{ embedding: number[]; captured_by?: string | null }>; replace?: boolean }, signal?: AbortSignal) =>
    request<{ prints: BiometricPrintSummary[]; replaced: number }>("/api/biometric-prints/enrollments", { method: "POST", body: JSON.stringify(input), signal }),
  // Owner/admin only (routes/store.ts's own gate) - null means the
  // package has no active store install (bundled-only, or never
  // installed). Called lazily, on-demand for the pane's selected
  // package, never for every row: 33 real packages installed today,
  // and Remove's own real/disabled state is the only reason to ask.
  storeInstall: (id: string) => request<StoreInstall | null>(`/api/store/installs/${encodeURIComponent(id)}`),
  uninstallPreview: (id: string) => request<{ confirmation: string }>(`/api/store/installs/${encodeURIComponent(id)}/uninstall-preview`),
  uninstallPackage: (id: string) => request<{ ok: true; confirmation: string }>(`/api/store/installs/${encodeURIComponent(id)}/uninstall`, { method: "POST" }),
  hardware: () => request<HardwareInfo>("/api/host/hardware"),
  models: (role: string) => request<ModelFit[]>(`/api/host/models?role=${encodeURIComponent(role)}`),
  computerMemory: () => request<ComputerMemoryResponse>("/api/computer-memory"),
  fitPlan: (body: { source: { url: string } | { path: string } | { repo: string; revision?: string }; context_tokens?: number; kv_cache_type?: "f16" | "q8_0" | "q4_0" }) => request<FitPlanResponse>("/api/fit-plan", { method: "POST", body: JSON.stringify(body) }),
  chatModels: () => request<ChatModelsResponse>("/api/host/chat-models"),
  chatCapabilities: () => request<ChatCapabilities>("/api/host/chat-capabilities"),
  modelSelection: () => request<{ modelId: string | null; name: string | null; state: string; installed?: string[] }>("/api/host/models/selection"),
  /** MODEL-SWITCH-01: download (when the Stack lacks it) or load one catalog chat model. */
  chooseChatModel: (id: string) => request<ChatModelChoice>(`/api/host/models/${encodeURIComponent(id)}/select`, { method: "POST", body: JSON.stringify({}) }),
  chatModelChoice: (id: string) => request<ChatModelChoice>(`/api/host/models/${encodeURIComponent(id)}/select-status`),
  senses: () => request<{ brain: string; voice: string }>("/api/health", { timeoutMs: 8_000 }),
  // The fuller shape of the same /api/health response, for Settings ->
  // Household -> Health (HealthSection.tsx) - senses() above stays
  // narrow because that's all the chat status pill (useEngineHealth.ts)
  // has ever needed.
  health: () => request<HealthStatus>("/api/health", { timeoutMs: 8_000 }),
  statusBoard: () => request<StatusBoard>("/api/status/board"),
  engineComputerStatus: () => request<EngineComputerStatus>("/api/status/engine-computer"),
  statusApps: () => request<StatusAppsResponse>("/api/status/apps"),
  healthChecks: () => request<HealthChecks>("/api/health-checks"),
  runHealthChecks: (input: { include_search?: boolean; include_picture?: boolean } = {}) => request<HealthChecks>("/api/health-checks/run", { method: "POST", body: JSON.stringify(input), timeoutMs: 300_000 }),
  statusHistory: async (days = 90) => {
    const history = await request<StatusHistory>(`/api/status/history?days=${days}`);
    if (!Array.isArray(history.components) || !Array.isArray(history.incidents)) throw new Error("Status history is not available.");
    return history;
  },
  postStatusNote: (input: { body: string; expires_at?: string }) => request<StatusNote>("/api/status/note", { method: "POST", body: JSON.stringify(input) }),
  clearStatusNote: () => request<void>("/api/status/note", { method: "DELETE" }),
  createMaintenance: (input: { title: string; description?: string; components: string[]; starts_at: string; ends_at: string; rrule?: string; until?: string }) => request<MaintenanceWindow>("/api/status/maintenance", { method: "POST", body: JSON.stringify(input) }),
  cancelMaintenance: (id: string) => request<MaintenanceWindow>(`/api/status/maintenance/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  engineStatus: () => request<EngineStatus>("/api/host/engine/status"),
  engineStats: () => request<EngineStatsSample[]>("/api/host/engine/stats"),
  stopEngine: () => request<EngineStatus>("/api/host/engine/stop", { method: "POST", timeoutMs: 15_000 }),
  // 100s: a little past the backend's own 90s bound (routes/host.ts), so
  // this client-side timeout only ever fires as the second, independent
  // safety net (a dead connection the server never sees), never races a
  // legitimate server-side response that's about to arrive.
  restartEngine: () => request<EngineStatus>("/api/host/engine/restart", { method: "POST", timeoutMs: 100_000 }),
  restartEngineRole: (role: "chat" | "embed" | "voice" | "background") =>
    request<{ role: string; restarted: true }>(`/api/host/engines/${role}/restart`, { method: "POST", timeoutMs: 100_000 }),
  stopEngineRole: (role: "chat" | "embed" | "voice" | "background") =>
    request<{ role: string; stopped: true }>(`/api/host/engines/${role}/stop`, { method: "POST", timeoutMs: 15_000 }),
  startEngineRole: (role: "chat" | "embed" | "voice" | "background") =>
    request<{ role: string; started: true }>(`/api/host/engines/${role}/start`, { method: "POST", timeoutMs: 100_000 }),
  // The whole hub, not just the chat engine - the process exits and the
  // OS service manager brings it back (routes/host.ts's own comment has
  // the full reasoning). A short timeout: this only waits for the "yes,
  // I got your request" response, never for the restart itself to finish.
  restartServer: () => request<{ ok: true; restarting: true }>("/api/host/restart", { method: "POST", timeoutMs: 15_000 }),
  // Returns the raw Response so the caller (sentenceSpeechScheduler.ts or
  // chatSpeechAdapter.ts) can read the streamed audio/wav body directly.
  // 185s: a first spawn of the Pocket TTS sidecar can take a while
  // Stack's speech request wait); only bounds waiting for the
  // response to begin, per rawStreamPost's own doc comment. A speech
  // adapter passes its AbortSignal so cancellation stops the
  // in-flight fetch/reader loop. Optional so the sentence scheduler's
  // existing calls (which have no per-sentence abort concept) are
  // unaffected.
  streamSpeech: (text: string, signal?: AbortSignal, turn?: { turnId: string; generation: number }) =>
    rawStreamPost("/api/tts", { text, ...(turn ? { turn_id: turn.turnId, generation: turn.generation } : {}) }, 185_000, "Timed out waiting for voice", signal),
  reactTurn: (said: string) => request<{ text: string | null }>("/api/turn/react", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ said }), timeoutMs: 2500 }),
  prewarmTurn: () => request<{ warmed: boolean }>("/api/turn/prewarm", { method: "POST" }),
  cancelTurn: (turnId: string, heardChars?: number) => request<{ cancelled: boolean }>(`/api/turn/${encodeURIComponent(turnId)}/cancel`, { method: "POST", ...(heardChars === undefined ? {} : { body: JSON.stringify({ heard_chars: heardChars }) }) }),
  // A first preview can include the Stack's pinned voice download, so let
  // the Stack response complete without Home guessing a timeout.
  previewVoice: (id: string, signal?: AbortSignal) =>
    rawStreamPost(`/api/voice/voices/${encodeURIComponent(id)}/preview`, {}, 0, undefined, signal, "audio/wav"),
  // Real token-by-token streaming (2026-09-04): the reply text arrives as
  // it's generated instead of all at once, the prerequisite for speaking
  // it sentence by sentence as it's typed (spec/voice/README.md's "what
  // Jesse actually meant by streamed"). No client-side timeout: an
  // ordinary reply's own generation time is exactly the wait this call
  // has to tolerate, and routes/turn.ts has no server-side bound on it
  // either - a hung stream is a real, separate gap to close later, not
  // guessed at with an arbitrary number here.
  // `signal` (step 4): the assistant-ui runtime's own abortSignal for a
  // stopped run, so a user-initiated "stop" actually cancels the fetch
  // instead of leaving the browser's request racing pointlessly against
  // work nothing will read the result of.
  //
  // An options object, not five more positional params (a code review,
  // 2026-09-13, found the growing positional list already forced
  // `runFixedTurn.ts` into four throwaway `undefined`s just to reach
  // `ephemeral`, with two same-typed optional booleans a silent reorder
  // away from swapping): every param but `text` and `signal` (the two
  // every real caller passes) lives here instead.
  streamTurn: (
    text: string,
    signal?: AbortSignal,
    opts: { thinking?: boolean; model?: string; conversationId?: string; mentionCompanionId?: string; tryCompanionId?: string; supersedes?: string; ephemeral?: boolean; resumeToken?: string; turnId?: string; resumeFrom?: number; continuation?: { assistantText: string; fromTurnId?: string }; bare?: boolean; packageScope?: string; temporary?: boolean; spoken?: boolean; currentLocation?: { lat: number; lon: number }; pageContext?: import("@maipai/spec/gen/ts/page-context.js").PageContext; askAnswer?: { turnId: string; approved: boolean } | { turnId: string; values: Record<string, string | number | boolean | null> }; documentAttachments?: { name: string; mediaType: string; data: string }[]; images?: { id: string; name: string; width: number; height: number; media_type: string }[]; assistantStream?: boolean } = {},
  ) =>
    rawStreamPost(
      "/api/turn/stream",
      // `package_scope`: SHELL-02 slice 6's own Apps menu (COMPOSER-
      // TOOL-SCOPE-01, docs/BACKLOG.md) - additive per Compatibility,
      // not read by routes/turn.ts yet (the old turn path is frozen),
      // carried behind NEXT_CHAT_UNWIRED_CONTROLS_ENABLED so it has no
      // real effect until U2's turn-request fields land.
      // `temporary`: CHAT-HEADER-01's own "start temporary chat" entry -
      // only meaningful on the first turn of a brand new conversation
      // (`opts.conversationId` unset); routes/turn.ts's own 403 for a
      // minor already covers the same floor `canHaveTemporaryChatRole`
      // gates the menu entry on client-side.
      // `spoken`: VOICE-LIVE-02's live voice session - RESP-01's flag,
      // read by the new path only (U6a); the frozen path ignores it.
      // `ask_answer` (APPROVE-CARD-01): a tapped approve/deny card
      // (ConfirmTool, ChatPage.tsx) - read by the new path only
      // (routes/turn.ts's own `askAnswer` zod schema), matched against
      // the conversation's live pending ask by `turn_id`
      // (turnMachine/turnNext.ts's `resumesAsk()`).
      { surface: "chat", text, thinking: opts.thinking, model: opts.model, conversation_id: opts.conversationId, mention_companion_id: opts.mentionCompanionId, try_companion_id: opts.tryCompanionId, supersedes: opts.supersedes, ephemeral: opts.ephemeral, continuation_text: opts.continuation?.assistantText, continuation_of: opts.continuation?.fromTurnId, resume_token: opts.resumeToken, turn_id: opts.turnId, resume_from: opts.resumeFrom, bare: opts.bare, package_scope: opts.packageScope, temporary: opts.temporary, spoken: opts.spoken, current_location: opts.currentLocation, page_context: opts.pageContext, ask_answer: opts.askAnswer ? "values" in opts.askAnswer ? { turn_id: opts.askAnswer.turnId, values: opts.askAnswer.values } : { turn_id: opts.askAnswer.turnId, approved: opts.askAnswer.approved } : undefined, document_attachments: opts.documentAttachments?.map(({ name, mediaType, data }) => ({ name, media_type: mediaType, data })), images: opts.images },
      0,
      undefined,
      signal,
      // THIN-5E: the web chat reads the assistant-stream wire (lib/
      // assistantTurnStream.ts); every other caller keeps NDJSON.
      opts.assistantStream ? "application/x-assistant-stream" : undefined,
    ),
  // ADMIN-COMPARE-01: owner/admin only on the server (a 403 for anyone
  // else, checked before this ever streams); the frontend gate is just
  // for not showing the action to begin with.
  compareTurnBare: (conversationId: string, turnId: string, signal?: AbortSignal) =>
    rawStreamPost("/api/turn/bare", { conversation_id: conversationId, turn_id: turnId }, 0, undefined, signal),
};
