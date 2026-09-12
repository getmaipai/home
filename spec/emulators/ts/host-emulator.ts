// A deterministic, offline stand-in for the host.* RPC surface (platform
// plan 4.9), for testing Tier 0 recipes and Tier 1 packages without a real
// hub or robot. Nothing here does real network I/O, real scheduling, or
// real persistence: every method is backed by in-memory state a test seeds
// and inspects. See docs/dev.md for how this differs from the real host.

export class HostError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HostError";
  }
}

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
}

export interface MemoryRecordLike {
  id?: string;
  text: string;
  category?: string;
  scope?: string;
  person?: string | null;
}

export interface LogEntry {
  level: string;
  message: string;
  fields: Record<string, unknown>;
}

const REDACTED = "[redacted]";

// Shared by this emulator's log() and the real host's
// (backend/src/lib/packageHost.ts), so a redaction fix (a depth limit, a
// regex-metachar-safe replace) lands once instead of needing to be
// remembered and reapplied to a second copy — a review (2026-09-04)
// found the two had already drifted (this one didn't recurse into
// arrays) before either implementation shipped.
export function redactSecrets(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const secret of secrets) {
      if (secret) out = out.split(secret).join(REDACTED);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactSecrets(v, secrets)]));
  }
  return value;
}

// The real host.* RPC surface's shape (4.9), extracted so a real
// implementation (backend/src/lib/packageHost.ts) can be typed against
// the same contract the interpreter runs against, instead of the
// interpreter being tied to this emulator's concrete class. The Python
// interpreter never had this problem (recipe_interpreter.py's `host`
// parameter is already `Any`, pure duck typing); this is a TS-only
// tightening, not a spec/record shape change.
export interface Host {
  /** The one host.* method that is genuinely async (2026-09-05): a real
   * fetch is real network I/O, so runRecipe()'s `fetch` step is the only
   * step that ever awaits anything. Every other method here stays
   * synchronous - this interface is intentionally NOT "everything is a
   * promise for consistency," since none of the rest do real I/O the
   * interpreter needs to wait on. */
  fetch(url: string, opts?: FetchOptions): Promise<unknown>;
  memory: {
    // Widened to allow a Promise (step 5, session-a-intelligence.md):
    // the real host (packageHost.ts) now embeds the query text before
    // scoring, real I/O the interpreter has to await - but this
    // emulator's own deterministic substring match has nothing to await,
    // so it stays a plain synchronous return rather than an
    // unconditional Promise wrapper. `await`ing a non-Promise value is
    // itself a no-op in JS, so the interpreter's one `await` line (below)
    // works correctly against either implementation with no emulator or
    // conformance-fixture changes needed.
    recall(query: string, opts?: { scope?: string; person?: string }): MemoryRecordLike[] | Promise<MemoryRecordLike[]>;
    remember(text: string, category?: string, scope?: string, person?: string | null): string;
  };
  action: {
    emit(kind: string, payload?: unknown): void;
  };
  home: {
    // Async like fetch (the ONE other async member of this interface):
    // the real host (packageHost.ts) makes a real network call to the
    // household's own Home Assistant instance, so callers must await it -
    // the interpreter does, same as it does for fetch (2026-09-05, the
    // real home.call_service landing).
    call_service(domain: string, service: string, target: unknown, data?: unknown): Promise<void>;
  };
  integration: {
    // Already covers a Promise, unlike memory.recall's own interface
    // comment on the identical situation - `unknown | Promise<unknown>`
    // collapses to plain `unknown` (a code review, 2026-09-06, caught an
    // earlier version of this comment claiming a type-system effect that
    // didn't happen), so no signature change was needed here at all: the
    // real host (packageHost.ts, session-d step 4) makes a real network
    // call for Home Assistant's own integration methods, real I/O the
    // interpreter has to await, while this emulator's own canned-response
    // lookup has nothing to await and returns synchronously - `unknown`
    // already accepts either, and `await`ing a non-Promise value is a
    // no-op in JS, so the interpreter's one `await` line works correctly
    // against both implementations.
    call(id: string, method: string, args?: unknown): unknown;
  };
  speak: {
    sentence(text: string): void;
  };
  llm: {
    // Promise-typed like fetch/home.call_service above: the real host
    // (packageHost.ts, session-d-packages-and-store.md step 7) makes a
    // real model-inference call, so callers must await it.
    complete(opts: unknown): Promise<unknown>;
  };
  camera: {
    still(): unknown;
  };
  ocr: {
    read(image: unknown): string;
  };
  config: {
    get(key: string): unknown;
  };
  log(level: string, message: string, fields?: Record<string, unknown>): void;
  /** `inputs` (session-d-packages-and-store.md step 8) closes a real,
   * previously-documented gap: the real host used to always pass `{}`
   * here regardless of what a recipe's own `schedule` step asked for, so
   * a job re-firing this package lost its own input scope entirely. */
  schedule(when: string, job: string, inputs?: Record<string, unknown>): string;
  lists: {
    add(text: string): void;
    /** A ready-to-speak summary of the household's own default shopping
     * list - the same "resolve a list-shaped result into one string at
     * the interpreter, since the recipe language has no loop" move
     * `memory.recall`'s own binding already makes. */
    view(): string;
  };
  reminders: {
    /** The real natural-language time/task parsing AND the real
     * scheduling both happen here, host-side - a declarative recipe step
     * can do neither for itself. Schedules a core-kind job (never a
     * recipe replay): firing later raises `remind.due` directly. */
    set(text: string): { task: string; when_text: string };
  };
  timers: {
    /** Deterministic duration parsing, not a language model: a timer's
     * whole point is exact minute-level accuracy. Schedules a core-kind
     * job; firing later raises `timer.done` directly. */
    set(text: string): { label: string; when_text: string };
  };
  files: {
    read(path: string): unknown;
    write(path: string, data: unknown): void;
    list(prefix: string): string[];
  };
  data: {
    forget(person: string): number;
  };
  diagnostics(): unknown;
}

export class HostEmulator implements Host {
  constructor(private readonly actorId = "person-a1b2c3") {}

  private fetchResponses = new Map<string, unknown>();
  private configValues = new Map<string, unknown>();
  private secrets: string[] = [];
  private memoryStoreState: (MemoryRecordLike & { id: string })[] = [];
  private filesState = new Map<string, unknown>();
  private nextId = 1;

  readonly actionsLog: { kind: string; payload: unknown }[] = [];
  readonly homeCallsLog: { domain: string; service: string; target: unknown; data: unknown }[] = [];
  readonly spokenLog: string[] = [];
  readonly scheduledJobs: { when: string; job: string; id: string; inputs: Record<string, unknown> }[] = [];
  // {text, done} pairs, not plain strings (a code review, 2026-09-06,
  // found the emulator had no concept of "done" at all while the real
  // host's own lists.view() filters completed items out - a real
  // interpreter/host divergence no fixture could have caught, since
  // there was nothing here to seed a done item with).
  private shoppingListState: { text: string; done: boolean }[] = [];
  readonly logs: LogEntry[] = [];

  // --- test setup -----------------------------------------------------

  setFetchResponse(url: string, body: unknown): void {
    this.fetchResponses.set(url, body);
  }

  seedMemory(records: MemoryRecordLike[]): void {
    for (const r of records) {
      this.memoryStoreState.push({ ...r, id: r.id ?? this.genId("mem") });
    }
  }

  seedConfig(key: string, value: unknown): void {
    this.configValues.set(key, value);
  }

  /** A value registered here is replaced with [redacted] anywhere log() would emit it. */
  registerSecret(value: string): void {
    this.secrets.push(value);
  }

  get memoryStore(): readonly (MemoryRecordLike & { id: string })[] {
    return this.memoryStoreState;
  }

  // --- host.* surface ---------------------------------------------------

  // Still no real network I/O - a canned lookup wrapped in a resolved/
  // rejected promise, matching the real host's now-async signature so a
  // recipe test exercises the exact same `await host.fetch(...)` shape
  // runRecipe() actually calls in production.
  async fetch(url: string, _opts?: FetchOptions): Promise<unknown> {
    if (!this.fetchResponses.has(url)) {
      throw new HostError("not_found", `no canned response for ${url}`);
    }
    return this.fetchResponses.get(url);
  }

  readonly memory = {
    recall: (query: string, opts?: { scope?: string; person?: string }): MemoryRecordLike[] => {
      if (opts?.person && opts.person !== this.actorId) {
        throw new HostError("permission_denied", "packages cannot recall another person's memories");
      }
      const q = query.toLowerCase();
      return this.memoryStoreState.filter((r) => {
        if (opts?.scope && r.scope !== opts.scope) return false;
        if (r.scope === "self") return false;
        if (r.scope === "person" && r.person !== this.actorId) return false;
        if (opts?.person && r.person !== this.actorId) return false;
        return r.text.toLowerCase().includes(q);
      });
    },
    remember: (
      text: string,
      category?: string,
      scope?: string,
      person?: string | null,
    ): string => {
      const id = this.genId("mem");
      this.memoryStoreState.push({ id, text, category, scope, person: person ?? null });
      return id;
    },
  };

  readonly action = {
    emit: (kind: string, payload?: unknown): void => {
      this.actionsLog.push({ kind, payload });
    },
  };

  readonly home = {
    call_service: async (domain: string, service: string, target: unknown, data?: unknown): Promise<void> => {
      this.homeCallsLog.push({ domain, service, target, data });
    },
  };

  readonly integration = {
    call: (id: string, method: string, _args?: unknown): unknown => {
      const key = `${id}:${method}`;
      if (!this.fetchResponses.has(key)) {
        throw new HostError("not_found", `no canned integration response for ${key}`);
      }
      return this.fetchResponses.get(key);
    },
  };

  readonly speak = {
    sentence: (text: string): void => {
      this.spokenLog.push(text);
    },
  };

  readonly llm = {
    complete: async (_opts: unknown): Promise<unknown> => {
      return { text: "[emulator: no model loaded, this is a canned reply]" };
    },
  };

  readonly camera = {
    still: (): unknown => {
      throw new HostError("capability_missing", "no camera in the emulator");
    },
  };

  readonly ocr = {
    read: (_image: unknown): string => {
      throw new HostError("capability_missing", "no ocr in the emulator");
    },
  };

  readonly config = {
    get: (key: string): unknown => {
      return this.configValues.has(key) ? this.configValues.get(key) : null;
    },
  };

  log(level: string, message: string, fields: Record<string, unknown> = {}): void {
    this.logs.push({
      level,
      message: redactSecrets(message, this.secrets) as string,
      fields: redactSecrets(fields, this.secrets) as Record<string, unknown>,
    });
  }

  schedule(when: string, job: string, inputs: Record<string, unknown> = {}): string {
    const id = this.genId("job");
    this.scheduledJobs.push({ when, job, id, inputs });
    return id;
  }

  readonly lists = {
    add: (text: string): void => {
      this.shoppingListState.push({ text, done: false });
    },
    view: (): string => {
      const pending = this.shoppingListState.filter((i) => !i.done);
      return pending.length > 0 ? pending.map((i) => i.text).join(", ") : "Your shopping list is empty.";
    },
  };

  /** Test setup only: seeds the emulator's own shopping list, `done`
   * items included, so a fixture can prove `lists.view()` really does
   * skip them - the same "test setup" role `seedMemory()` already plays
   * for `memory.recall`. */
  seedShoppingList(items: { text: string; done?: boolean }[]): void {
    for (const item of items) {
      this.shoppingListState.push({ text: item.text, done: item.done ?? false });
    }
  }

  // No real time-phrase or duration parsing here - deliberately canned,
  // the same "[emulator: ...]" convention llm.complete's own stub
  // already uses, since this emulator does no real I/O or computation.
  // The real host (packageHost.ts) does the real parsing; a conformance
  // fixture proves the recipe -> host -> scheduledJobs wiring, not real
  // NL understanding.
  readonly reminders = {
    set: (text: string): { task: string; when_text: string } => {
      const id = this.genId("job");
      this.scheduledJobs.push({ when: "[emulator: no real time parsing]", job: "reminders.fire", id, inputs: { task: text } });
      return { task: text, when_text: "[emulator: no real time parsing]" };
    },
  };

  readonly timers = {
    set: (text: string): { label: string; when_text: string } => {
      const id = this.genId("job");
      this.scheduledJobs.push({ when: "[emulator: no real duration parsing]", job: "timers.fire", id, inputs: { label: text } });
      return { label: text, when_text: "[emulator: no real duration parsing]" };
    },
  };

  readonly files = {
    read: (path: string): unknown => {
      if (!this.filesState.has(path)) {
        throw new HostError("not_found", `no file at ${path}`);
      }
      return this.filesState.get(path);
    },
    write: (path: string, data: unknown): void => {
      this.filesState.set(path, data);
    },
    list: (prefix: string): string[] => {
      return [...this.filesState.keys()].filter((k) => k.startsWith(prefix));
    },
  };

  readonly data = {
    forget: (person: string): number => {
      const before = this.memoryStoreState.length;
      this.memoryStoreState = this.memoryStoreState.filter((r) => r.person !== person);
      const forgottenFiles = [...this.filesState.keys()].filter((k) => k.startsWith(`person:${person}/`));
      for (const k of forgottenFiles) this.filesState.delete(k);
      return before - this.memoryStoreState.length + forgottenFiles.length;
    },
  };

  diagnostics(): unknown {
    return {
      ok: true,
      memory_records: this.memoryStoreState.length,
      scheduled_jobs: this.scheduledJobs.length,
    };
  }

  private genId(prefix: string): string {
    return `${prefix}-emu${String(this.nextId++).padStart(4, "0")}`;
  }
}
