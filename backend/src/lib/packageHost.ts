// The real host.* RPC surface (platform plan 4.9), Tier 0 only: no Deno
// sandbox, no MCP, no process boundary, because a Tier 0 recipe is
// declarative and runs natively in the interpreter (5.2's "no process").
// Implements the `Host` interface extracted in
// spec/emulators/ts/host-emulator.ts so spec/interpreters/ts's
// runRecipe() can run a real recipe against real data, not just the
// emulator.
//
// Every method backed by a real store checks the manifest's declared
// `permissions` first (spec/vocab/permissions.json): a package that
// didn't declare `memory:write` gets `permission_denied`, not a silent
// call-through. Errors always use a code from spec/errors/errors.json
// (docs/ENGINEERING.md > Errors: "the host wraps errors so a package
// cannot throw an unmapped one past the boundary"); nothing here invents
// a new code.
//
// What's real: memory.recall, memory.remember, data.forget, config.get
// (household scope only), schedule (lib/scheduler.ts, with a known gap,
// see that call site below), log (with real redaction), and - 2026-09-05
// - fetch: a real outbound HTTP call, permission-gated
// (`net:<host>`), rate-limited per destination host (lib/rateLimiter.ts,
// the org's own "a page every few seconds, not dozens a second" budget),
// and refused outright for a private/loopback/link-local target
// (lib/ssrfGuard.ts - a package's generic fetch has no business landing
// on the household's own LAN; home.call_service/integration.call are the
// real, permissioned paths for that). This was the one thing genuinely
// blocking every fetch-based skill until the interpreter itself could
// await a host call at all (recipe-interpreter.ts, both languages, made
// async the same day this landed) - `runSkill()`/`prepareTurn()` now
// await through to here.
//
// Everything else (home.call_service, integration.call, speak.sentence,
// camera.still, ocr.read, files.*, action.emit, diagnostics) still has no
// backing service (no Home Assistant link, no turn engine action route,
// no package file storage) and throws `capability_missing`, checked
// against the permission it would need first so the error is as specific
// as it can honestly be. `llm.complete` is the same code but a different
// reason: the `chat` role IS real (lib/llm.ts, lib/llmSupervisor.ts,
// spec/llm/), and the interpreter can now await a host call - but no
// recipe step calls llm.complete (recipe.schema.json has no "llm" step),
// so there is still nothing to wire this to, a real gap independent of
// the sync/async one that's now closed. See spec/llm/README.md and
// docs/dev.md's Package Host section for everything else deferred and why.
import type { Host, FetchOptions, MemoryRecordLike } from "@maipai/spec/emulators/ts/host-emulator.js";
import { HostError, redactSecrets } from "@maipai/spec/emulators/ts/host-emulator.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { tryConsume } from "@/lib/rateLimiter";
import { assertNotPrivateHost, SsrfBlockedError } from "@/lib/ssrfGuard";
import * as memory from "@/lib/memory";
import * as settings from "@/lib/settings";
import { scheduleJob } from "@/lib/scheduler";
import type { PersonRow } from "@/types";

// host.fetch's real network I/O settings (2026-09-05). Rate limit: "a
// page every few seconds, not dozens a second" (.github/CLAUDE.md) - a
// small burst allowance (a recipe's own fetch+pick+format, or one retry)
// then a sustained ~1 request per 5 seconds per destination host. Timeout
// and response cap are plain defensive limits, not policy: generous
// enough for any real JSON API, small enough that one broken integration
// can't hang a turn or exhaust memory.
const FETCH_RATE_LIMIT = { capacity: 5, refillPerSecond: 0.2 };
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_USER_AGENT = "MaiPai-Home/1.0 (+https://github.com/getmaipai/home)";

function hasHeaderCaseInsensitive(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

// A code review (2026-09-05) found response.text() read the ENTIRE body
// into memory before this ever compared it to FETCH_MAX_RESPONSE_BYTES,
// so the cap could not do the one thing its own comment claimed
// ("exhaust memory") - a large or malicious body fully materialized
// every time regardless. Streamed and counted in real bytes (not
// text.length's UTF-16 code units, which undercount multi-byte UTF-8)
// so the read itself aborts the moment the limit is crossed, before the
// rest of the body ever arrives.
async function readBodyWithLimit(response: Response, url: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > FETCH_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new HostError("network_unreachable", `${url}'s response exceeded the ${FETCH_MAX_RESPONSE_BYTES}-byte limit`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

// A real, live-verified reliability gap found building the `define`
// skill (2026-09-05): dictionaryapi.dev, a real public API, failed
// (timed out) roughly half the time in rigorous back-to-back testing
// tonight - a real third-party host, not a bug in host.fetch's own
// networking (see ssrfGuard.ts's own comment on the dead-end chased
// before landing on this explanation). One bounded retry, GET-only:
// idempotent by definition, so trying again can't double-apply a write,
// and a single real-world timeout is far more likely to be transient
// packet loss / a bad edge node in a round-robin pool than a
// permanently broken destination. Never retries a real HTTP response
// (even an error one, like a genuine 404 for a word that doesn't
// exist) - the server already answered; asking again wastes a whole
// timeout window for an answer that won't change.
const RETRY_DELAY_MS = 500;

export interface AttemptResult {
  ok: boolean;
  value?: unknown;
  error?: HostError;
  /** True only for a genuine network-level failure (timeout, DNS, TLS,
   * connection refused) - never for a real HTTP response, including a
   * non-2xx one. Only this class of failure is worth retrying. */
  networkFailure?: boolean;
}

async function attemptHttpFetch(url: string, method: string, headers: Record<string, string>, body: string | undefined): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, networkFailure: false, error: new HostError("network_unreachable", `${url} returned HTTP ${response.status}`) };
    }
    const text = await readBodyWithLimit(response, url);
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: true, value: text }; // a real API answering plain text/HTML is not a host.fetch failure
    }
  } catch (err) {
    if (err instanceof HostError) return { ok: false, networkFailure: false, error: err }; // e.g. readBodyWithLimit's own size-cap error
    const message = (err as Error).name === "AbortError" ? "timed out" : (err as Error).message;
    return { ok: false, networkFailure: true, error: new HostError("network_unreachable", `could not reach ${url}: ${message}`) };
  } finally {
    clearTimeout(timer);
  }
}

/** The real HTTP-calling mechanics, pulled out of createHost()'s fetch so
 * they're directly testable against a real local test server: permission,
 * SSRF, and rate-limit checks all happen in the caller (createHost()'s
 * fetch, below) before this ever runs, and have nothing to do with a
 * real server's own loopback address (which this function has no opinion
 * about at all - guarding against reaching the household's own LAN is
 * exactly what the caller's checks are for, not this one). */
/** The retry POLICY itself, pulled out as its own small, pure function so
 * it's unit-testable with a fake `attempt` and a near-zero `delayMs` -
 * no real network I/O and no real 10-second timeout to wait out just to
 * prove "fails once then succeeds" or "a non-network failure is never
 * retried" actually hold. Retries at most once, and only when `retryable`
 * (the real caller passes `method === "GET"`) and the first result was a
 * genuine network-level failure. */
export async function withOneRetry(attempt: () => Promise<AttemptResult>, retryable: boolean, delayMs: number): Promise<AttemptResult> {
  const first = await attempt();
  if (first.ok || !first.networkFailure || !retryable) return first;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return attempt();
}

export async function performHttpFetch(url: string, opts?: FetchOptions): Promise<unknown> {
  const method = opts?.method ?? "GET";
  let body: string | undefined;
  if (opts?.body !== undefined) body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "user-agent": FETCH_USER_AGENT, ...opts?.headers };
  if (body !== undefined && typeof opts?.body !== "string" && !hasHeaderCaseInsensitive(headers, "content-type")) {
    headers["content-type"] = "application/json";
  }

  const result = await withOneRetry(() => attemptHttpFetch(url, method, headers, body), method === "GET", RETRY_DELAY_MS);
  if (result.ok) return result.value;
  throw result.error;
}

function mapWriteFailure(status: 400 | 403 | 404, error: string): never {
  // A permission check above only proves the manifest declared the
  // right permission; memory.remember/forget still apply their own
  // caller/scope authorization (role, scope=self, another person's
  // record) that the manifest can't see in advance, and their own input
  // validation. Map each to the real catalogue code rather than
  // collapsing every failure into permission_denied.
  const code = status === 400 ? "invalid_input" : status === 404 ? "not_found" : "permission_denied";
  throw new HostError(code, error);
}

/** Builds a real host for one package invocation, scoped to the acting
 * person and that package's declared manifest (permissions gate what it
 * may call; `id` stamps provenance on anything it writes and every log
 * line). `secrets`: values to redact from any log() call, e.g. a
 * credential a future integration call resolved for this invocation. */
export function createHost(actor: PersonRow, manifest: PackageManifest, secrets: readonly string[] = []): Host {
  const hasPermission = (perm: string) => manifest.permissions?.includes(perm) ?? false;

  function requirePermission(perm: string): void {
    if (!hasPermission(perm)) {
      throw new HostError("permission_denied", `${manifest.id} did not declare permission ${perm}`);
    }
  }

  // capability_missing is the closest fit errors.json has ("A required
  // capability... is not present on this node"), used here for "the
  // real host hasn't wired this RPC at all yet" too, which is a
  // platform-wide gap, not a per-node hardware one — the catalogue has
  // no code for that distinction (a review, 2026-09-04, flagged the
  // mismatch: capability_missing's spoken_fallback, "I can't do that on
  // this device," implies switching devices would help, which isn't
  // true here). Tracked as a real spec gap in docs/dev.md rather than
  // silently picking a code and moving on; none of these paths are
  // reachable through any real product surface yet (no turn engine
  // routes to them, and the one bundled package doesn't call them), so
  // the misleading copy has no live blast radius today.
  function notImplemented(method: string): never {
    throw new HostError("capability_missing", `host.${method} is not implemented on this host build yet, on any node (Tier 0 only, see docs/dev.md)`);
  }

  return {
    async fetch(url: string, opts?: FetchOptions): Promise<unknown> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new HostError("invalid_input", `not a valid url: ${url}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new HostError("invalid_input", `unsupported url scheme: ${parsed.protocol}`);
      }
      requirePermission(`net:${parsed.host}`);

      // Rate limit BEFORE the SSRF/DNS check, not after: a package
      // hammering host.fetch against a host that turns out to be blocked
      // (or invalid) still costs a real DNS lookup and connection attempt
      // per call, and the household's own hub deserves protection from
      // that regardless of whether the target was ever going to be
      // allowed - not just the destination service's own budget.
      if (!tryConsume(parsed.host, FETCH_RATE_LIMIT)) {
        throw new HostError("rate_limited", `host.fetch is rate-limited for ${parsed.host} - try again shortly`);
      }

      try {
        await assertNotPrivateHost(parsed.hostname);
      } catch (err) {
        if (err instanceof SsrfBlockedError) throw new HostError("invalid_input", err.message);
        throw new HostError("network_unreachable", `could not resolve ${parsed.hostname}`);
      }

      return performHttpFetch(url, opts);
    },
    memory: {
      recall(query: string, opts?: { scope?: string; person?: string }): MemoryRecordLike[] {
        requirePermission("memory:read");
        const listOpts: memory.ListOptions = {};
        if (opts?.scope === "household" || opts?.scope === "person" || opts?.scope === "self") {
          listOpts.scope = opts.scope;
        }
        if (opts?.person) listOpts.person = opts.person;
        return memory
          .recall(actor, query, listOpts)
          .map(({ record }) => ({ id: record.id, text: record.text, category: record.category, scope: record.scope, person: record.person }));
      },
      remember(text: string, category?: string, scope?: string, person?: string | null): string {
        requirePermission("memory:write");
        const result = memory.remember(actor, {
          text,
          category: category ?? "fact",
          tier: "durable",
          scope: scope ?? "household",
          person: scope === "person" ? (person ?? undefined) : undefined,
          source: `package:${manifest.id}`,
          importance: 0.5,
        });
        if (!result.ok) mapWriteFailure(result.status, result.error);
        return result.value.id;
      },
    },
    action: {
      emit(kind: string, _payload?: unknown): void {
        requirePermission(`actions:${kind}`);
        notImplemented("action.emit");
      },
    },
    home: {
      call_service(_domain: string, _service: string, _target: unknown, _data?: unknown): void {
        notImplemented("home.call_service");
      },
    },
    integration: {
      call(id: string, _method: string, _args?: unknown): unknown {
        requirePermission(`integration:${id}`);
        notImplemented("integration.call");
      },
    },
    speak: {
      sentence(_text: string): void {
        requirePermission("speak");
        notImplemented("speak.sentence");
      },
    },
    llm: {
      complete(_opts: unknown): unknown {
        requirePermission("llm:complete");
        notImplemented("llm.complete");
      },
    },
    camera: {
      still(): unknown {
        requirePermission("camera:still");
        notImplemented("camera.still");
      },
    },
    ocr: {
      read(_image: unknown): string {
        requirePermission("ocr");
        notImplemented("ocr.read");
      },
    },
    config: {
      // No permission exists in the vocab for a package's own declared
      // config: authorization is already the settings store's own
      // scope-read rule (household settings are readable by anyone
      // signed in), applied by listValues itself.
      get(key: string): unknown {
        const result = settings.listValues(actor, "household");
        if (!result.ok) return null;
        return result.value.find((v) => v.key === key)?.value ?? null;
      },
    },
    log(level: string, message: string, fields: Record<string, unknown> = {}): void {
      const entry = {
        level,
        timestamp: new Date().toISOString(),
        package: manifest.id,
        message: redactSecrets(message, secrets),
        fields: redactSecrets(fields, secrets),
      };
      console.log(JSON.stringify(entry));
    },
    // Real, but with a known gap: neither this interface nor the
    // interpreter's schedule-step handling carries the recipe's input
    // scope through, so the job re-fires the package with an empty
    // input scope, not today's inputs. See lib/scheduler.ts's header.
    schedule(when: string, job: string): string {
      requirePermission("schedule");
      const result = scheduleJob(actor, manifest.id, job, when, {});
      if (!result.ok) mapWriteFailure(result.status, result.error);
      return result.value.id;
    },
    files: {
      read(path: string): unknown {
        requirePermission(`files:${path}`);
        notImplemented("files.read");
      },
      write(path: string, _data: unknown): void {
        requirePermission(`files:${path}`);
        notImplemented("files.write");
      },
      list(_prefix: string): string[] {
        notImplemented("files.list");
      },
    },
    data: {
      // Not a Tier 0 recipe op (no `forget` step exists in recipe.schema.
      // json) and not in the permissions vocab: this is a privileged
      // erasure call a Tier 1 package or an admin flow would make, backed
      // directly by memory.forget()'s own authorization
      // (assertCanForgetOrExport), not a package permission.
      forget(person: string): number {
        const result = memory.forget(actor, person);
        if (!result.ok) mapWriteFailure(result.status, result.error);
        return result.value.deleted;
      },
    },
    diagnostics(): unknown {
      notImplemented("diagnostics");
    },
  };
}
