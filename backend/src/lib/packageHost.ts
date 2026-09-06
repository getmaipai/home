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
// blocking every fetch-based plugin until the interpreter itself could
// await a host call at all (recipe-interpreter.ts, both languages, made
// async the same day this landed) - `runPlugin()`/`prepareTurn()` now
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
import { getHouseholdSettingValue } from "@/lib/settings";
import { scheduleJob } from "@/lib/scheduler";
import { cachedFetch } from "@/lib/packageCache";
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

// host.home.call_service's real settings (2026-09-05, closing the first of
// the two gaps docs/dev.md named for it). A shorter timeout than
// host.fetch's: this is a household's own local Home Assistant instance,
// almost always on the same LAN, not an arbitrary internet API - a call
// that hasn't answered in 5s is already a bad sign. One shared rate-limit
// bucket keyed by a fixed name, not per-host like host.fetch: every
// package talks to the SAME single configured instance, so the budget is
// naturally per-installation already; a slightly higher burst than
// host.fetch's because turning on three lights for a "goodnight" routine
// is one real household action, not three independent ones.
const HOME_ASSISTANT_RATE_LIMIT_KEY = "home_assistant";
const HOME_ASSISTANT_RATE_LIMIT = { capacity: 10, refillPerSecond: 0.5 };
const HOME_ASSISTANT_TIMEOUT_MS = 5_000;

// The recipe schema's own comment on `home_call_service_step`
// ("security domains are never covered by a wildcard target") named a
// design requirement with nothing implementing it. `home:<domain>`
// (spec/vocab/permissions.json) already makes a *wildcard* structurally
// impossible - requirePermission does exact string matching, the same as
// `net:<host>`, so a manifest can't declare `home:*` and match everything.
// This list is the other half: a fixed set of domains whose services can
// change physical access to the home (locking/unlocking, opening a garage
// or a valve, arming/disarming an alarm), each requiring the manifest to
// also declare `consequential: true` (4.5's routing-confidence bar) on
// top of the ordinary `home:<domain>` permission - a package that only
// wants `light`/`switch`/`climate` never needs to clear this bar.
const HOME_ASSISTANT_SECURITY_DOMAINS = new Set(["lock", "alarm_control_panel", "cover", "garage_door", "valve"]);

/** Lowercased once here too, for the same reason createHost()'s own
 * call_service does it - the only caller outside this file
 * (lib/commands.ts, 2026-09-05: a household-authored command touching
 * a security domain needs the identical check at creation time, not a
 * second hand-copied domain list that could drift from this one). */
export function isHomeAssistantSecurityDomain(domain: string): boolean {
  return HOME_ASSISTANT_SECURITY_DOMAINS.has(domain.toLowerCase());
}

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
// plugin (2026-09-05): dictionaryapi.dev, a real public API, failed
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
  /** The real HTTP status, when a response was received at all (never
   * set for a genuine network-level failure) - session-d step 4's own
   * `getHomeAssistantState` needs this to remap a 404 to `not_found`
   * rather than the generic `network_unreachable` every other non-2xx
   * gets, without hand-rolling its own copy of this function's fetch/
   * timeout/abort/body-limit sequence just to see the status code. */
  status?: number;
}

// SEC-3 (code review, 2026-09-06): fetch's default redirect: "follow"
// meant the SSRF/permission check the caller ran against the ORIGINAL
// url (createHost()'s fetch, below) said nothing about wherever a 3xx
// response then pointed - a package with `net:api.example.com` could
// fetch a url whose redirect landed on the household's own LAN or the
// hub's own tailnet address, and the response would come straight back.
// `redirect: "manual"` plus this loop re-runs `validateHop` (the same
// assertNotPrivateHost + requirePermission check the caller did on the
// original url) against every hop's own target before ever following it.
const MAX_FETCH_REDIRECTS = 5;

/** 301/302 historically downgrade a non-GET/HEAD request to GET on
 * redirect (what every browser and fetch's own "follow" mode does,
 * despite the HTTP spec technically allowing either); 303 always does,
 * regardless of the original method; 307/308 always preserve the
 * original method and body. Same table `fetch`'s built-in follow
 * behavior already used before this switched to manual redirects. */
function redirectedMethod(status: number, method: string): string {
  if (status === 303) return "GET";
  if ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD") return "GET";
  return method;
}

async function attemptHttpFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  validateHop?: (hopUrl: string) => Promise<void>,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = url;
    let currentMethod = method;
    let currentBody = body;
    for (let hop = 0; ; hop++) {
      const response = await fetch(currentUrl, { method: currentMethod, headers, body: currentBody, signal: controller.signal, redirect: "manual" });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (location) {
        if (hop >= MAX_FETCH_REDIRECTS) {
          return { ok: false, networkFailure: false, error: new HostError("network_unreachable", `${url} redirected more than ${MAX_FETCH_REDIRECTS} times`) };
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return { ok: false, networkFailure: false, error: new HostError("network_unreachable", `${currentUrl} redirected to an invalid url`) };
        }
        if (validateHop) {
          try {
            await validateHop(nextUrl);
          } catch (err) {
            if (err instanceof HostError) return { ok: false, networkFailure: false, error: err };
            throw err;
          }
        }
        currentMethod = redirectedMethod(response.status, currentMethod);
        if (currentMethod === "GET") currentBody = undefined;
        currentUrl = nextUrl;
        continue;
      }
      if (!response.ok) {
        return {
          ok: false,
          networkFailure: false,
          status: response.status,
          error: new HostError("network_unreachable", `${url} returned HTTP ${response.status}`),
        };
      }
      const text = await readBodyWithLimit(response, currentUrl);
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch {
        return { ok: true, value: text }; // a real API answering plain text/HTML is not a host.fetch failure
      }
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
 * exactly what the caller's checks are for, not this one, other than
 * re-running that exact same check, via `validateHop`, against a
 * redirect's own target - see attemptHttpFetch()'s own header for why
 * that specific piece can't live in the caller alone). */
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

/** `validateHop`, when given, is called with each redirect's own target
 * url before it's followed - the caller's real callers (createHost()'s
 * fetch) pass the exact SSRF + `net:<host>` permission check they ran
 * against the original url, so it can never mean less for hop 2 than
 * hop 1 did. Omitted by every direct test of this function's own HTTP
 * mechanics (packageHost.test.ts's own header on that describe block) -
 * those exercise a real local server with no SSRF concern of its own. */
export async function performHttpFetch(url: string, opts?: FetchOptions, validateHop?: (hopUrl: string) => Promise<void>): Promise<unknown> {
  const method = opts?.method ?? "GET";
  let body: string | undefined;
  if (opts?.body !== undefined) body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "user-agent": FETCH_USER_AGENT, ...opts?.headers };
  if (body !== undefined && typeof opts?.body !== "string" && !hasHeaderCaseInsensitive(headers, "content-type")) {
    headers["content-type"] = "application/json";
  }

  const result = await withOneRetry(
    () => attemptHttpFetch(url, method, headers, body, FETCH_TIMEOUT_MS, validateHop),
    method === "GET",
    RETRY_DELAY_MS,
  );
  if (result.ok) return result.value;
  throw result.error;
}

/** The real HTTP call behind host.home.call_service, pulled out the same
 * way performHttpFetch is so it's directly testable against a local
 * `Bun.serve` test server. Deliberately no retry, unlike host.fetch's
 * GET path: a service call is a real-world action (turning a light on,
 * unlocking a door), so retrying a call that may have already succeeded
 * but timed out on the response risks firing it twice - `toggle` services
 * make that a real, visible bug (the light ends up back off), not a
 * theoretical one. Also deliberately no SSRF guard here, unlike
 * host.fetch: the target is `baseUrl`, a value the HOUSEHOLD configured
 * in settings, never something a package supplies - a package can only
 * name a domain/service/target within that fixed instance, so there's no
 * attacker-influenced URL for a guard to check. Reaching the household's
 * own LAN device is the entire point of this call, not a hole in it. */
export async function callHomeAssistantService(
  baseUrl: string,
  accessToken: string,
  domain: string,
  service: string,
  target: unknown,
  data: unknown,
): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;

  // Isolated from the network try/catch below on purpose: fetch() itself
  // throws a plain TypeError for a genuine connection failure (the Fetch
  // spec's own "a network error" rejection shape, which attemptHttpFetch's
  // existing pattern deliberately doesn't discriminate on by class, only
  // by AbortError for a timeout) - catching TypeError around the fetch
  // call too would misclassify a real unreachable-host failure as a bad
  // request instead. This only catches a non-serializable target/data
  // (a BigInt, a circular reference), which would otherwise throw a raw,
  // unmapped TypeError past this function's "every failure is a HostError"
  // contract (found in review, 2026-09-05).
  let body: string;
  try {
    body = JSON.stringify({ ...(typeof target === "object" && target ? target : {}), ...(typeof data === "object" && data ? data : {}) });
  } catch (err) {
    throw new HostError("invalid_input", `${domain}.${service}'s target/data couldn't be turned into a request body: ${(err as Error).message}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOME_ASSISTANT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body,
      signal: controller.signal,
    });
    await readBodyWithLimit(response, url); // drain so the connection is released even when the caller ignores the result
    if (!response.ok) {
      throw new HostError("network_unreachable", `Home Assistant returned HTTP ${response.status} for ${domain}.${service}`);
    }
  } catch (err) {
    if (err instanceof HostError) throw err;
    const message = (err as Error).name === "AbortError" ? "timed out" : (err as Error).message;
    throw new HostError("network_unreachable", `could not reach Home Assistant at ${baseUrl}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** The read half of the Home Assistant integration (session-d-packages-
 * and-store.md step 4): `GET /api/states/<entity_id>`, the first thing a
 * recipe can reach through `host.integration.call("home_assistant",
 * "get_state", ...)` rather than `home.call_service`'s write-only
 * surface - "is the porch light on" has no service to call, only state
 * to read. Same connection posture as `callHomeAssistantService`
 * (household-configured baseUrl, no SSRF guard, a real GET this time so
 * genuinely safe to retry once on a transient failure the way
 * `performHttpFetch`'s own `withOneRetry` already does for `host.fetch` -
 * unlike a service call, reading state twice can never double-fire a
 * real-world action). */
export async function getHomeAssistantState(baseUrl: string, accessToken: string, entityId: string): Promise<unknown> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/states/${encodeURIComponent(entityId)}`;
  const headers = { authorization: `Bearer ${accessToken}` };
  // Reuses attemptHttpFetch/withOneRetry rather than hand-rolling a
  // second fetch/timeout/abort/body-limit sequence (a code review,
  // 2026-09-06, found the first version doing exactly that, with a
  // comment claiming a retry that wasn't actually there). A GET read is
  // genuinely safe to retry once, unlike a service call: reading state
  // twice can never double-fire a real-world action, so `retryable` is
  // unconditionally true here.
  const result = await withOneRetry(() => attemptHttpFetch(url, "GET", headers, undefined, HOME_ASSISTANT_TIMEOUT_MS), true, RETRY_DELAY_MS);
  if (result.ok) return result.value;
  if (result.status === 404) {
    throw new HostError("not_found", `Home Assistant returned HTTP 404 for entity ${entityId}`);
  }
  throw result.error;
}

/** The settings lookup and rate limit shared by every real Home Assistant
 * call: `homeCallService` (below) and `homeAssistantGetState` (step 4).
 * Throws the identical "isn't set up yet" error either way, since both
 * need the same two settings to reach the same instance. */
function requireHomeAssistantSettings(): { baseUrl: string; accessToken: string } {
  const baseUrl = getHouseholdSettingValue("home.base_url") as string | undefined;
  const accessToken = getHouseholdSettingValue("home.access_token") as string | undefined;
  if (!baseUrl || !accessToken) {
    throw new HostError("invalid_input", "Home Assistant isn't set up yet - add its URL and access token in Settings first");
  }
  if (!tryConsume(HOME_ASSISTANT_RATE_LIMIT_KEY, HOME_ASSISTANT_RATE_LIMIT)) {
    throw new HostError("rate_limited", "Home Assistant is rate-limited - try again shortly");
  }
  return { baseUrl, accessToken };
}

/** `host.integration.call("home_assistant", "get_state", { entity_id })`'s
 * real implementation. The one Home Assistant method reachable through
 * the generic `integration.call` step rather than `home.call_service`'s
 * own dedicated one - a read has no domain to gate on
 * `isHomeAssistantSecurityDomain`'s own list, so `integration:
 * home_assistant` (already required by createHost()'s generic
 * `integration.call` wrapper) is the only gate a read needs. */
export async function homeAssistantGetState(args: unknown): Promise<unknown> {
  const entityId = (args as { entity_id?: unknown } | undefined)?.entity_id;
  if (typeof entityId !== "string" || entityId.length === 0) {
    throw new HostError("invalid_input", `home_assistant get_state needs a string "entity_id" argument`);
  }
  const { baseUrl, accessToken } = requireHomeAssistantSettings();
  return getHomeAssistantState(baseUrl, accessToken, entityId);
}

/** The settings lookup, rate limit, and real call shared by every real
 * caller of Home Assistant - createHost()'s own call_service (permission
 * and consequential already checked by then) and lib/commands.ts's
 * household-authored home_call_service commands (authorized differently -
 * at creation time, by requiring the creator be owner/admin for a
 * security domain - but needing the identical settings/rate-limit/call
 * plumbing once authorized). Pulled out specifically so that plumbing
 * lives in exactly one place, not two independently-maintained copies. */
export async function homeCallService(domain: string, service: string, target: unknown, data: unknown): Promise<void> {
  const { baseUrl, accessToken } = requireHomeAssistantSettings();
  await callHomeAssistantService(baseUrl, accessToken, domain, service, target, data);
}

// First-person scope detection for Host.memory.remember (step 2). A
// leading "I"/"my"/"me"/"mine" is enough of a signal for a package like
// `remember` whose whole job is transcribing what the speaker just said
// about themself - deliberately simple, matched on the whole captured
// utterance the same way `remember`'s own routing.patterns capture it
// (word-boundary so "my" doesn't fire on "army", and "\bi\b" alone also
// matches the leading "i" in "i'm"/"i've"/"i'll"/"i'd" since the
// apostrophe is itself a word-boundary character).
//
// A code review (2026-09-05) found the plain version misattributed a
// THIRD PARTY's fact to the speaker's own private scope: "remember my
// sister's allergy is peanuts" contains "my", so it wrote scope person,
// person actor.id - the sister's allergy, filed as the parent's own
// secret, and (combined with turnEngine.ts's selfOnly recall) invisible
// to everyone else including the sister. `my <word>'s` names someone
// ELSE's thing, not the speaker's own, so it's stripped before the
// first-person check runs; a bare "i"/"me"/"mine" elsewhere still
// counts, which doesn't fully resolve every case ("my son's teacher
// emailed me" still has a standalone "me") - fully resolving possessives
// from the speaker's own point of view needs real language
// understanding, exactly what step 6's real judge is for
// ("possessives resolved from the speaker's view... never 'likely your
// daughter'"). This deterministic floor only ever closes the clearest,
// most common failure shape a household member's own phrasing produces.
const THIRD_PARTY_POSSESSIVE = /\bmy\s+\S+'s\b/gi;
const FIRST_PERSON_PATTERN = /\b(i|my|mine|me)\b/i;

function isFirstPersonStatement(text: string): boolean {
  return FIRST_PERSON_PATTERN.test(text.replace(THIRD_PARTY_POSSESSIVE, ""));
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
 * credential a future integration call resolved for this invocation.
 * `turnId` (session-a-intelligence.md step 2): when this invocation is
 * happening inside a conversation turn, `memory.remember()`'s own
 * `source` becomes this turn id (the spec's canonical provenance:
 * memory-record.schema.json's `source` is "e.g. a conversation turn
 * id... a package id"), not `package:<id>` - the memory-record shape has
 * no second field for the package id (checked: additionalProperties is
 * false and nothing else fits), so the package is logged instead of
 * stored when this happens. Omitted for an invocation with no turn (a
 * direct plugin run, a scheduled job): `source` falls back to
 * `package:<id>`, unchanged from before this parameter existed. */
export function createHost(actor: PersonRow, manifest: PackageManifest, secrets: readonly string[] = [], turnId?: string): Host {
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

  // Extracted from the returned `log()` method (below) so an internal
  // caller within createHost() - memory.remember()'s own turn-provenance
  // note, step 2 - can log through the same redacted, stamped path
  // docs/ENGINEERING.md's logging standard requires, instead of a raw
  // console.log a code review (2026-09-05) found bypassing it.
  function logEntry(level: string, message: string, fields: Record<string, unknown> = {}): void {
    const entry = {
      level,
      timestamp: new Date().toISOString(),
      package: manifest.id,
      message: redactSecrets(message, secrets),
      fields: redactSecrets(fields, secrets),
    };
    console.log(JSON.stringify(entry));
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

      // SEC-3 (code review, 2026-09-06): the exact same two checks this
      // function just ran against the ORIGINAL url, re-run against every
      // redirect hop's own target by attemptHttpFetch()'s loop - a
      // package declaring `net:api.example.com` gets no more than that
      // one host, permission-wise, even through a redirect, and a
      // redirect landing on the household's LAN or the hub's own tailnet
      // address is refused the same way the original url would have
      // been.
      const validateHop = async (hopUrl: string): Promise<void> => {
        let hopParsed: URL;
        try {
          hopParsed = new URL(hopUrl);
        } catch {
          throw new HostError("invalid_input", `redirected to an invalid url: ${hopUrl}`);
        }
        if (hopParsed.protocol !== "http:" && hopParsed.protocol !== "https:") {
          throw new HostError("invalid_input", `redirected to an unsupported url scheme: ${hopParsed.protocol}`);
        }
        requirePermission(`net:${hopParsed.host}`);
        try {
          await assertNotPrivateHost(hopParsed.hostname);
        } catch (err) {
          if (err instanceof SsrfBlockedError) throw new HostError("invalid_input", err.message);
          throw new HostError("network_unreachable", `could not resolve ${hopParsed.hostname}`);
        }
      };

      // The cache sits in front of the rate limiter and the SSRF check on
      // purpose (session-d-packages-and-store.md step 3): a cache hit is
      // not a network call at all, so it should cost neither a rate-limit
      // token nor a DNS lookup - only a real doFetch() (below) reaches
      // either. A package with no `cache` declared skips straight
      // through, unaffected.
      return cachedFetch(manifest.id, manifest.cache, url, opts, async () => {
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

        return performHttpFetch(url, opts, validateHop);
      });
    },
    memory: {
      // Async as of step 5 (session-a-intelligence.md): a real embed()
      // call is real I/O, so this package-facing recall now genuinely
      // has something to await, the same justification host.fetch/
      // home.call_service already carry in this interface. Host.memory.
      // recall's own interface type stays widened to allow either shape
      // (spec/emulators/ts/host-emulator.ts's own comment) so the
      // deterministic test emulator doesn't need to change at all.
      async recall(query: string, opts?: { scope?: string; person?: string }): Promise<MemoryRecordLike[]> {
        requirePermission("memory:read");
        const listOpts: memory.ListOptions = {};
        if (opts?.scope === "household" || opts?.scope === "person" || opts?.scope === "self") {
          listOpts.scope = opts.scope;
        }
        if (opts?.person) listOpts.person = opts.person;
        const queryVector = await memory.embedQueryForRecall(query);
        return memory
          .recall(actor, query, { ...listOpts, queryVector })
          .map(({ record }) => ({ id: record.id, text: record.text, category: record.category, scope: record.scope, person: record.person }));
      },
      remember(text: string, category?: string, scope?: string, person?: string | null): string {
        requirePermission("memory:write");
        // Step 2: "the remember recipe writes scope: person and person:
        // actor.id for first-person statements... and household
        // otherwise." A recipe step that already declares its own scope
        // (recall's own "recall" step, or a future package with a real
        // reason to write household explicitly) is left alone; auto-
        // detection only applies when the step left scope unset, which
        // is what backend/packages/remember/recipe.json now does.
        const resolvedScope = scope ?? (isFirstPersonStatement(text) ? "person" : "household");
        const resolvedPerson = resolvedScope === "person" ? (person ?? actor.id) : undefined;
        // Provenance: the turn id when this call is happening inside a
        // turn (see createHost()'s own comment on why there's no second
        // field for the package id), package id otherwise.
        const source = turnId ?? `package:${manifest.id}`;
        if (turnId) logEntry("info", "remembered via turn", { turn_id: turnId });
        const result = memory.remember(actor, {
          text,
          category: category ?? "fact",
          tier: "durable",
          scope: resolvedScope,
          person: resolvedPerson,
          source,
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
      async call_service(rawDomain: string, service: string, target: unknown, data?: unknown): Promise<void> {
        // Normalized once and used for every decision below (permission,
        // the security-domain check, and the real call) - the same
        // protection host.fetch's net:<host> gets for free from URL's own
        // hostname lowercasing. Without this, a manifest declaring
        // "home:Lock" and calling call_service("Lock", ...) would pass
        // requirePermission's exact-string match but miss
        // isHomeAssistantSecurityDomain's lowercase-only check, silently
        // skipping the consequential:true requirement this check exists
        // to enforce (found in review, 2026-09-05). Real Home Assistant
        // domains are canonically lowercase anyway, so this costs nothing
        // for a correctly-written package.
        const domain = rawDomain.toLowerCase();
        requirePermission(`home:${domain}`);
        if (isHomeAssistantSecurityDomain(domain) && manifest.consequential !== true) {
          throw new HostError(
            "permission_denied",
            `${manifest.id} must declare "consequential": true to call the security domain "${domain}"`,
          );
        }
        await homeCallService(domain, service, target, data ?? null);
      },
    },
    integration: {
      // Home Assistant, the first integration reachable through this
      // generic path (session-d-packages-and-store.md step 4) - a read
      // (get_state) rather than home.call_service's own dedicated,
      // domain-gated write path. Every other id/method combination stays
      // capability_missing until a second integration is actually built;
      // this is deliberately not a registry pattern for one entry.
      async call(id: string, method: string, args?: unknown): Promise<unknown> {
        requirePermission(`integration:${id}`);
        if (id === "home_assistant" && method === "get_state") {
          return homeAssistantGetState(args);
        }
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
    log: logEntry,
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
    // Real as of session-d-packages-and-store.md step 4: a package's own
    // self-diagnostic snapshot - id, version, tier, and the permissions
    // it actually declared (not whether each is currently working; a
    // real health check per permission, e.g. "is net:api.open-meteo.com
    // reachable right now," is F's Health/Repairs surface's job, not
    // this method's). Genuinely useful today even with nothing else
    // behind it: "what does this package think it is" is a real,
    // answerable question a support flow can already ask.
    diagnostics(): unknown {
      return {
        id: manifest.id,
        version: manifest.version,
        tier: manifest.tier,
        permissions: manifest.permissions ?? [],
      };
    },
  };
}
