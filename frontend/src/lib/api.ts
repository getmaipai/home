import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { Issue } from "@maipai/spec/gen/ts/issue.js";
import type { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import type {
  Roster,
  TurnValue,
  TurnStreamEvent,
  ConversationTurnRow,
  ConversationTurnWithMemoryIds,
  ConversationSummary,
  ResolvedSetting,
  BackupInfo,
  HardwareInfo,
  ModelFit,
  ModelJob,
  EngineStatus,
  EngineStatsSample,
  ClonedVoiceInfo,
  RoutingStats,
  PrivacyConnection,
  PendingRestore,
  CommandRow,
  CommandAction,
  NotificationDeliveryView,
  HealthStatus,
} from "@maipai/home-backend/src/wire";
import { isOwnerOrAdminRole } from "@maipai/home-backend/src/wire";
import { readTextLines } from "@maipai/spec/streaming/ts/lineReader.js";

// GET /api/people (routes/people.ts) returns toRoster()'s output directly
// - the same Omit<Person, "birthdate"> shape Roster wraps, minus
// Roster's own hasSecret (that field only exists on /api/auth/profiles'
// response, added by that route, not toRoster() itself). Derived from
// the real spec type rather than hand-listing fields again.
export type PersonRosterEntry = Omit<Person, "birthdate">;
export type Role = Person["role"];

// Real backend types, imported from @/wire (not hand-duplicated): a code
// review (2026-09-04) flagged an earlier version of this file for
// hand-typing mirrors of these three, which could silently drift from the
// real shapes since nothing linked them. Importing turnEngine.ts or
// conversationHistory.ts directly instead of @/wire does not work here:
// those files (and personShape.ts) pull in backend's own "@/..." path
// aliases, which frontend's tsconfig has no mapping for - @/wire exists
// specifically because it has no such imports. frontend/package.json
// depends on @maipai/home-backend as a workspace package for this;
// re-export the types here so the rest of the frontend imports from one
// place.
export type { Roster, TurnValue, TurnStreamEvent, ConversationTurnRow, ConversationTurnWithMemoryIds, ConversationSummary, ResolvedSetting, BackupInfo, HardwareInfo, ModelFit, ModelJob, EngineStatus, EngineStatsSample, ClonedVoiceInfo, RoutingStats, PrivacyConnection, PendingRestore, CommandRow, CommandAction, NotificationDeliveryView, HealthStatus };
export type { MemoryRecord };
export type { PackageManifest };
export type { Issue };
export type { Conversation };
export { isOwnerOrAdminRole };
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
  createdAt: string;
}
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
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
  const { timeoutMs, ...rest } = init ?? {};
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const res = await fetch(path, {
      ...rest,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...rest.headers },
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
      throw new ApiError(body.error ?? res.statusText, res.status, body.code);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({}));
      throw new ApiError(parsed.error ?? res.statusText, res.status, parsed.code);
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

export const api = {
  profiles: () => request<Roster[]>("/api/auth/profiles"),
  setup: (displayName: string, secret: string) =>
    request<{ person: unknown }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ displayName, secret }),
    }),
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
  me: () => request<Roster>("/api/auth/me"),
  logout: () => request<{ success: true }>("/api/auth/logout", { method: "POST" }),
  // Session E step 6: "sessions and devices with revoke" - both scoped
  // to the caller's own profile (devices.ts's own comment: "not a
  // household-wide admin view"), the same personal-Profile-page scope
  // PIN/password change already has.
  devices: () => request<DeviceInfo[]>("/api/devices"),
  revokeDevice: (id: string) =>
    request<{ success: true }>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sessions: () => request<SessionInfo[]>("/api/auth/sessions"),
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
  conversationList: (person?: string) =>
    request<ConversationSummary[]>(`/api/conversations${person ? `?person=${encodeURIComponent(person)}` : ""}`),
  createConversation: () => request<Conversation>("/api/conversations", { method: "POST", body: JSON.stringify({ surface: "chat" }) }),
  resumeConversation: (id: string) => request<Conversation>(`/api/conversations/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  conversation: (id: string) => request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`),
  conversationTurns: (id: string) => request<ConversationTurnWithMemoryIds[]>(`/api/conversations/${encodeURIComponent(id)}/turns`),
  renameConversation: (id: string, title: string | null) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (id: string) =>
    request<{ ok: true }>(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  batchDeleteConversations: (ids: string[]) =>
    request<{ deleted: number }>("/api/conversations/batch-delete", { method: "POST", body: JSON.stringify({ ids }) }),
  clearConversations: () => request<{ deleted: number }>("/api/conversations/clear", { method: "POST" }),
  settingsRegistry: () => request<SettingsKey[]>("/api/settings/registry"),
  settingsValues: (scope: string) =>
    request<ResolvedSetting[]>(`/api/settings?scope=${encodeURIComponent(scope)}`),
  setSetting: (scope: string, key: string, value: unknown) =>
    request<ResolvedSetting>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ scope, key, value }),
    }),
  // The community voice catalog (2026-09-04): every real file in
  // `kyutai/tts-voices`, not just the 26 bundled presets.
  voiceCatalog: () => request<{ entries: { path: string; collection: string }[] }>("/api/voice/catalog"),
  selectVoiceFromCatalog: (path: string) =>
    request<ResolvedSetting>("/api/voice/catalog/select", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  // Dedicated routes, not the generic setSetting/resetSetting: saving or
  // removing voice.hf_token has to restart the tts backend so the
  // already-running pocket-tts process picks up the change (see
  // routes/voice.ts's own comment on why the generic PUT route has no
  // hook for that).
  setHfToken: (token: string) =>
    request<ResolvedSetting>("/api/voice/hf-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  removeHfToken: () => request<ResolvedSetting>("/api/voice/hf-token/remove", { method: "POST" }),
  // Voice cloning (2026-09-04): a household member's own uploaded audio
  // sample. uploadClonedVoice sends real multipart/form-data, not JSON -
  // request<T>() always JSON-encodes `body`, so this bypasses it and
  // calls fetch directly, the same reason tests/client.ts grew its own
  // postForm() alongside post().
  clonedVoices: () => request<{ voices: ClonedVoiceInfo[] }>("/api/voice/cloned"),
  uploadClonedVoice: async (file: File, label: string): Promise<ClonedVoiceInfo> => {
    const form = new FormData();
    form.set("label", label);
    form.set("file", file);
    const res = await fetch("/api/voice/cloned", { method: "POST", credentials: "include", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
    return body as ClonedVoiceInfo;
  },
  selectClonedVoice: (id: string) =>
    request<ResolvedSetting>(`/api/voice/cloned/${encodeURIComponent(id)}/select`, { method: "POST" }),
  deleteClonedVoice: (id: string) =>
    request<{ success: true }>(`/api/voice/cloned/${encodeURIComponent(id)}/delete`, { method: "POST" }),
  resetSetting: (scope: string, key: string) =>
    request<ResolvedSetting>("/api/settings/reset", {
      method: "POST",
      body: JSON.stringify({ scope, key }),
    }),
  people: () => request<PersonRosterEntry[]>("/api/people"),
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
    edit: { displayName?: string; nickname?: string | null; role?: string },
  ) =>
    request<PersonRosterEntry>(`/api/people/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(edit),
    }),
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
  notifications: () => request<NotificationDeliveryView[]>("/api/notifications"),
  notificationHistory: () => request<NotificationDeliveryView[]>("/api/notifications/history"),
  markNotificationRead: (id: string) =>
    request<NotificationDeliveryView>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  dismissNotification: (id: string) =>
    request<{ id: string }>(`/api/notifications/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
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
  widgetData: (pkg: string, id: string) =>
    request<WidgetData>(`/api/widgets/${encodeURIComponent(pkg)}/${encodeURIComponent(id)}/data`).catch(
      (e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return { as_of: new Date().toISOString(), items: [] };
        throw e;
      },
    ),
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
  // `person`, for the per-person view an adult opens for a child
  // (session E step 5): GET /api/memory's own `?person=` (backend/src/
  // routes/memory.ts's parseListOptions) - the same real access check
  // (assertCanForgetOrExport-adjacent) every other per-person read in
  // this app already relies on server-side, not re-implemented here.
  memories: (personId?: string) =>
    request<MemoryRecord[]>(`/api/memory${personId ? `?person=${encodeURIComponent(personId)}` : ""}`),
  forgetPersonMemories: (personId: string) =>
    request<{ deleted: number }>("/api/memory/forget", { method: "POST", body: JSON.stringify({ personId }) }),
  exportPersonMemories: (personId: string) =>
    request<MemoryRecord[]>(`/api/memory/export?personId=${encodeURIComponent(personId)}`),
  archiveMemory: (id: string) =>
    request<MemoryRecord>(`/api/memory/${encodeURIComponent(id)}/archive`, { method: "POST" }),
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
    source: string;
    importance: number;
  }) => request<MemoryRecord>("/api/memory", { method: "POST", body: JSON.stringify(input) }),
  // GET /api/plugins (already on main): every installed package's
  // manifest, `routing.examples` included - the chat composer's empty-
  // state suggested prompts (step 4) are drawn from these rather than
  // invented, so they're always real things MaiPai can actually do.
  plugins: () => request<PackageManifest[]>("/api/plugins"),
  hardware: () => request<HardwareInfo>("/api/host/hardware"),
  models: (role: string) => request<ModelFit[]>(`/api/host/models?role=${encodeURIComponent(role)}`),
  modelSelection: () => request<{ modelId: string | null }>("/api/host/models/selection"),
  selectModel: (id: string) => request<ModelJob>(`/api/host/models/${encodeURIComponent(id)}/select`, { method: "POST" }),
  modelSelectStatus: (id: string) => request<ModelJob>(`/api/host/models/${encodeURIComponent(id)}/select-status`),
  senses: () => request<{ brain: string; voice: string }>("/api/health", { timeoutMs: 8_000 }),
  // The fuller shape of the same /api/health response, for Settings ->
  // Household -> Health (HealthSection.tsx) - senses() above stays
  // narrow because that's all the chat status pill (useEngineHealth.ts)
  // has ever needed.
  health: () => request<HealthStatus>("/api/health", { timeoutMs: 8_000 }),
  engineStatus: () => request<EngineStatus>("/api/host/engine/status"),
  engineStats: () => request<EngineStatsSample[]>("/api/host/engine/stats"),
  stopEngine: () => request<EngineStatus>("/api/host/engine/stop", { method: "POST", timeoutMs: 15_000 }),
  // 100s: a little past the backend's own 90s bound (routes/host.ts), so
  // this client-side timeout only ever fires as the second, independent
  // safety net (a dead connection the server never sees), never races a
  // legitimate server-side response that's about to arrive.
  restartEngine: () => request<EngineStatus>("/api/host/engine/restart", { method: "POST", timeoutMs: 100_000 }),
  // The whole hub, not just the chat engine - the process exits and the
  // OS service manager brings it back (routes/host.ts's own comment has
  // the full reasoning). A short timeout: this only waits for the "yes,
  // I got your request" response, never for the restart itself to finish.
  restartServer: () => request<{ ok: true; restarting: true }>("/api/host/restart", { method: "POST", timeoutMs: 15_000 }),
  // Returns the raw Response so the caller (sentenceSpeechScheduler.ts,
  // chatListenStore.ts) can read the streamed audio/wav body directly.
  // 185s: a first spawn of the Pocket TTS sidecar can take a while
  // (ttsSupervisor.ts's 180s health wait); only bounds waiting for the
  // response to begin, per rawStreamPost's own doc comment. `signal`
  // (step 4, a code review 2026-09-05): chatListenStore.ts's own
  // requestId guard stops updating state for a superseded "Listen"
  // click, but never actually cancelled the earlier click's in-flight
  // fetch/reader loop - it kept running in the background until it
  // finished or timed out. Optional so sentenceSpeechScheduler.ts's
  // existing calls (which have no per-sentence abort concept) are
  // unaffected.
  streamSpeech: (text: string, signal?: AbortSignal) =>
    rawStreamPost("/api/tts", { text }, 185_000, "Timed out waiting for voice", signal),
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
  streamTurn: (text: string, thinking?: boolean, signal?: AbortSignal, conversationId?: string) =>
    rawStreamPost("/api/turn/stream", { surface: "chat", text, thinking, conversation_id: conversationId }, 0, undefined, signal),
};
