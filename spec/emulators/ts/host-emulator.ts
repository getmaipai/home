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
  fetch(url: string, opts?: FetchOptions): unknown;
  memory: {
    recall(query: string, opts?: { scope?: string; person?: string }): MemoryRecordLike[];
    remember(text: string, category?: string, scope?: string, person?: string | null): string;
  };
  action: {
    emit(kind: string, payload?: unknown): void;
  };
  home: {
    call_service(domain: string, service: string, target: unknown, data?: unknown): void;
  };
  integration: {
    call(id: string, method: string, args?: unknown): unknown;
  };
  speak: {
    sentence(text: string): void;
  };
  llm: {
    complete(opts: unknown): unknown;
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
  schedule(when: string, job: string): string;
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
  private fetchResponses = new Map<string, unknown>();
  private configValues = new Map<string, unknown>();
  private secrets: string[] = [];
  private memoryStoreState: (MemoryRecordLike & { id: string })[] = [];
  private filesState = new Map<string, unknown>();
  private nextId = 1;

  readonly actionsLog: { kind: string; payload: unknown }[] = [];
  readonly homeCallsLog: { domain: string; service: string; target: unknown; data: unknown }[] = [];
  readonly spokenLog: string[] = [];
  readonly scheduledJobs: { when: string; job: string; id: string }[] = [];
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

  fetch(url: string, _opts?: FetchOptions): unknown {
    if (!this.fetchResponses.has(url)) {
      throw new HostError("not_found", `no canned response for ${url}`);
    }
    return this.fetchResponses.get(url);
  }

  readonly memory = {
    recall: (query: string, opts?: { scope?: string; person?: string }): MemoryRecordLike[] => {
      const q = query.toLowerCase();
      return this.memoryStoreState.filter((r) => {
        if (opts?.scope && r.scope !== opts.scope) return false;
        if (opts?.person && r.person !== opts.person) return false;
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
    call_service: (domain: string, service: string, target: unknown, data?: unknown): void => {
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
    complete: (_opts: unknown): unknown => {
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

  schedule(when: string, job: string): string {
    const id = this.genId("job");
    this.scheduledJobs.push({ when, job, id });
    return id;
  }

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
