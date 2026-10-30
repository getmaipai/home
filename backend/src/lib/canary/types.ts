// CANARY-01 (docs/design/reliability-2026-10-17.md): behavioural checks that run the real pipeline.
export type CanaryId = "chat_hello" | "embed" | "chat_tool_weather" | "spoken_turn" | "stt_tts_loopback" | "chat_picture_read" | "chat_search_trigger" | "image_tiny" | "gpu_metal";
export type CanaryGroup = "chat" | "tools" | "search" | "voice" | "pictures";

/** What one probe of the chat pipeline saw. No reply text is kept beyond the check that reads it. */
export interface ChatProbe {
  ok: boolean;
  text: string;
  /** Package ids of tool calls, in order. */
  toolCalls: string[];
  /** Package ids whose tool call failed. */
  toolErrors: string[];
  /** A spoken_cue arrived. */
  cue: boolean;
  firstTokenMs: number | null;
  totalMs: number;
  /** "timeout" | "unavailable" | the wire error code | null. */
  error: string | null;
}

export interface ChatProbeRequest { text: string; spoken?: boolean; picture?: boolean; timeoutMs: number }

export type RoleState = { availability: "ready" | "starting" | "unavailable"; reason: string | null; cause?: string };

/** Everything the checks touch, so tests run on fakes and never reach a live service. */
export interface CanaryDeps {
  chat(request: ChatProbeRequest): Promise<ChatProbe>;
  embed(): Promise<{ ok: boolean; dims: number; error?: string }>;
  /** TTS says the phrase, STT hears it. `heard` is compared and dropped. */
  loopback(phrase: string): Promise<{ ok: boolean; heard: string; stage?: "tts" | "stt"; error?: string }>;
  image(): Promise<{ ok: boolean; error?: string }>;
  chatRole(): Promise<RoleState>;
  visionReady(): Promise<boolean>;
  /** Plain-words reason synthetic work must wait (install, update, GPU job, memory, pause), or null. */
  blocker(): Promise<string | null>;
  /** A person's turn started or finished recently. */
  turnActive(): boolean;
  /** Ask the Stack for ONE supervised restart of the chat engine (its own self-heal path; the breaker keeps its count). False when it declines. */
  requestRestart(reason: string, role?: "chat" | "image" | "video"): Promise<boolean>;
  /** GPU-HEALTH-01: the Stack compiles one tiny shader. null when the Stack cannot be asked (older Stack, unreachable). */
  gpuCompile(): Promise<{ ok: boolean; reason: string | null } | null>;
  /** Home's load average is above twice the core count. */
  loadHigh(): boolean;
  /** A web search address is set, so the search check can mean something. */
  searchConfigured(): boolean;
  /** At most one canary restart per 30 minutes, remembered across restarts. */
  restartBudget: { allowed(): boolean; note(): void };
  /** The search service already reports a block, rate limit or outage. */
  searchTrouble(): boolean;
  keepWarm(): boolean;
  now(): number;
  random(): number;
}

export type Outcome =
  | { kind: "pass"; firstTokenMs?: number | null }
  /** `life`: "dead" the role reports not ready, "hung" no token at all before the deadline; absent means slow or wrong, never a reason to restart. */
  | { kind: "fail"; cause: string; fix: string; life?: "dead" | "hung" }
  | { kind: "skip"; reason: string };

export interface CanaryCheck {
  id: CanaryId;
  name: string;
  group: CanaryGroup;
  timeoutMs: number;
  /** Repairs title when it fails twice in a row. */
  title: string;
  run(deps: CanaryDeps, ctx: { searchPhrase: string; chatDown: boolean }): Promise<Outcome>;
}

export interface CheckResult {
  id: CanaryId;
  at: string;
  status: "pass" | "fail" | "skipped";
  durationMs: number;
  firstTokenMs: number | null;
  /** Plain cause (fail) or reason (skipped). Never any person's words. */
  note: string | null;
  life?: "dead" | "hung";
}
