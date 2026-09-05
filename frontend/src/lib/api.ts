import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { Person } from "@maipai/spec/gen/ts/person.js";
import type { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import type {
  Roster,
  TurnValue,
  TurnStreamEvent,
  ConversationTurnRow,
  ResolvedSetting,
  BackupInfo,
  HardwareInfo,
  ModelFit,
  ModelJob,
  EngineStatus,
  EngineStatsSample,
  ClonedVoiceInfo,
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
export type { Roster, TurnValue, TurnStreamEvent, ConversationTurnRow, ResolvedSetting, BackupInfo, HardwareInfo, ModelFit, ModelJob, EngineStatus, EngineStatsSample, ClonedVoiceInfo };
export type { MemoryRecord };
export { isOwnerOrAdminRole };
// SettingsKey is spec-generated (@maipai/spec), not backend-only, so it's
// imported directly rather than through @/wire.
export type { SettingsKey };
// SafetyResult flows through TurnValue.safety; re-exported for callers
// that want it by name without reaching into @maipai/spec directly.
export type { SafetyResult };

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
async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
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
async function rawStreamPost(
  path: string,
  body: unknown,
  timeoutMs: number,
  timeoutMessage = "Timed out waiting for a response",
): Promise<Response> {
  const { signal, clear } = withTimeout(timeoutMs);
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
  conversations: () => request<ConversationTurnRow[]>("/api/conversations"),
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
  memories: () => request<MemoryRecord[]>("/api/memory"),
  archiveMemory: (id: string) =>
    request<MemoryRecord>(`/api/memory/${encodeURIComponent(id)}/archive`, { method: "POST" }),
  hardware: () => request<HardwareInfo>("/api/host/hardware"),
  models: (role: string) => request<ModelFit[]>(`/api/host/models?role=${encodeURIComponent(role)}`),
  modelSelection: () => request<{ modelId: string | null }>("/api/host/models/selection"),
  selectModel: (id: string) => request<ModelJob>(`/api/host/models/${encodeURIComponent(id)}/select`, { method: "POST" }),
  modelSelectStatus: (id: string) => request<ModelJob>(`/api/host/models/${encodeURIComponent(id)}/select-status`),
  engineStatus: () => request<EngineStatus>("/api/host/engine/status"),
  engineStats: () => request<EngineStatsSample[]>("/api/host/engine/stats"),
  stopEngine: () => request<EngineStatus>("/api/host/engine/stop", { method: "POST", timeoutMs: 15_000 }),
  // 100s: a little past the backend's own 90s bound (routes/host.ts), so
  // this client-side timeout only ever fires as the second, independent
  // safety net (a dead connection the server never sees), never races a
  // legitimate server-side response that's about to arrive.
  restartEngine: () => request<EngineStatus>("/api/host/engine/restart", { method: "POST", timeoutMs: 100_000 }),
  // Returns the raw Response so the caller (sentenceSpeechScheduler.ts)
  // can read the streamed audio/wav body directly. 185s: a first spawn of
  // the Pocket TTS sidecar can take a while (ttsSupervisor.ts's 180s
  // health wait); only bounds waiting for the response to begin, per
  // rawStreamPost's own doc comment.
  streamSpeech: (text: string) => rawStreamPost("/api/tts", { text }, 185_000, "Timed out waiting for voice"),
  // Real token-by-token streaming (2026-09-04): the reply text arrives as
  // it's generated instead of all at once, the prerequisite for speaking
  // it sentence by sentence as it's typed (spec/voice/README.md's "what
  // Jesse actually meant by streamed"). No client-side timeout: an
  // ordinary reply's own generation time is exactly the wait this call
  // has to tolerate, and routes/turn.ts has no server-side bound on it
  // either - a hung stream is a real, separate gap to close later, not
  // guessed at with an arbitrary number here.
  streamTurn: (text: string, thinking?: boolean) =>
    rawStreamPost("/api/turn/stream", { surface: "chat", text, thinking }, 0),
};
