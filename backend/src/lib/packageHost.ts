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
// Everything else (speak.sentence, camera.still, ocr.read, files.*,
// action.emit, diagnostics, and integration.call for any id/method pair
// besides home_assistant's own get_state) still has no backing service
// (no turn engine action route, no package file storage) and throws
// `capability_missing`, checked against the permission it would need
// first so the error is as specific as it can honestly be. (This
// comment previously also listed home.call_service here; it's been real
// since session-d-packages-and-store.md step 4, and this paragraph had
// drifted - found while touching the adjacent llm.complete case below,
// not otherwise audited.)
//
// `llm.complete` is real too now (session-d-packages-and-store.md step
// 7, translate's own case) - the same `chat` role llm.complete has
// always been able to reach (lib/llm.ts), now that a recipe step
// (recipe.schema.json's `llm_complete`) actually calls it. One
// user-role completion per call, no system prompt, no conversation
// history, no streaming, no tool calling: a lookup, not a chat turn. A
// role other than `chat`, or a model that isn't loaded, reports
// `model_unavailable` rather than a raw error - the same "the host
// wraps errors so a package cannot throw an unmapped one" rule every
// other real method here already follows. See spec/llm/README.md and
// docs/dev.md's Package Host section for everything else deferred and
// why.
import type { Host, FetchOptions, MemoryRecordLike } from "@maipai/spec/emulators/ts/host-emulator.js";
import { HostError, redactSecrets } from "@maipai/spec/emulators/ts/host-emulator.js";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { Artifact as ArtifactValue } from "@maipai/spec/gen/ts/artifact.js";
import { createArtifact, updateArtifact, getArtifactRow } from "@/lib/artifacts";
import { isTemporaryConversation } from "@/lib/conversationHistory";
import { tryConsume } from "@/lib/rateLimiter";
import { recordSearchHealth } from "@/lib/searchHealthState";
import { assertNotPrivateHost, SsrfBlockedError } from "@maipai/core/src/ssrfGuard";
import * as memory from "@/lib/memory";
import { deleteAttachmentsForPerson } from "@/lib/attachments";
import * as settings from "@/lib/settings";
import { getHouseholdSettingValue } from "@/lib/settings";
import { scheduleJob, scheduleCoreJob } from "@/lib/scheduler";
import { findOrCreateStandingList, addItem as addListItem } from "@/lib/lists";
import { parseReminder, parseTimerDuration } from "@/lib/reminderParsing";
import { cachedFetch } from "@/lib/packageCache";
import { complete as llmComplete, type LlmMessage } from "@/lib/llm";
import { runRapidOcr } from "@/lib/documentExtraction";
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { resolveSafeSearchLevel, safeSearchNumericLevel, type SafeSearchLevel } from "@/lib/safeSearch";
import { getPersonSettingValue } from "@/lib/settings";
import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

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
const packageFetch = globalThis.fetch.bind(globalThis);

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

// The searxng integration's own settings (session-d-packages-and-store.md
// step 7): a household-configured SearXNG instance, the same
// household-configured-baseUrl shape (no SSRF guard, one shared rate
// limit) Home Assistant already established above - see
// backend/src/settings/searchKeys.ts's own header for why this is
// bring-your-own-instance rather than a bundled sidecar. A longer
// timeout than Home Assistant's: SearXNG fans a query out to several
// real search engines and waits on the slowest one, not a single LAN
// round-trip.
const SEARXNG_RATE_LIMIT_KEY = "searxng";
// SEARCH-PACE-01 (docs/plans/search-resilience-2026-09-24.md): tightened
// from {capacity: 10, refillPerSecond: 0.5} (a burst of 10, then one
// every 2s) to the design note's own stated budget - "a burst of
// three, then about one query every six seconds on average" - after
// tonight's own bench traffic (well within the old, looser numbers)
// helped get the household's real SearXNG rate-limited by its upstream
// engines. A person asking several things in a row is still a burst of
// three; nothing beyond that was ever a person's own pace.
const SEARXNG_RATE_LIMIT = { capacity: 3, refillPerSecond: 1 / 6 };
const SEARXNG_TIMEOUT_MS = 10_000;
// SEARCH-PACE-01: a review (2026-09-24) caught this budget shared with
// `pageFetch()` below - fetching a linked page is a different kind of
// traffic from querying SearXNG itself (one household question with
// `read_page: true` consumes one token from EACH), and the tightened
// search budget alone left as little as one page-read token free for
// a second, unrelated question moments later, spuriously rate-limiting
// ordinary back-to-back household conversation, not only a flood. Its
// own key and budget instead, sized to CLAUDE.md's own "Third-party
// services" rule for an arbitrary fetched page - "a page every few
// seconds, not dozens a second."
const SEARXNG_PAGE_RATE_LIMIT_KEY = "searxng-page";
const SEARXNG_PAGE_RATE_LIMIT = { capacity: 3, refillPerSecond: 0.5 };

// SEARCH-FALLBACK-01 (docs/plans/search-resilience-2026-09-24.md): "when
// SearXNG is down or returns nothing, the websearch tool asks Wikipedia
// through its official, documented API ... through the same per-host
// rate limiter" - its own key and budget, a different host from SearXNG
// entirely, sized the identical "a page every few seconds" way
// SEARXNG_PAGE_RATE_LIMIT already is.
const WIKIPEDIA_RATE_LIMIT_KEY = "wikipedia";
const WIKIPEDIA_RATE_LIMIT = { capacity: 3, refillPerSecond: 0.5 };
// A review, 2026-09-24, named a real, accepted cost: on a full SearXNG
// outage, its own 10s timeout plus Wikipedia's two sequential 10s
// fetches (search, then the summary) can stack to roughly 30s worst
// case before either an answer or the original error reaches the
// household. The identical shape `searxngPageRead()`'s own robots.txt-
// then-page sequence already has, already accepted there for the same
// reason: a real, slow answer from a real backend is not the transient
// blip a retry papers over (this file's own comment on why
// searxngSearch() itself has no retry, above) - not re-architected
// into a shared, reduced timeout budget across both fallback steps
// tonight, since SearXNG genuinely being unreachable (the common case)
// fails Wikipedia's own two calls fast, not slow.
const WIKIPEDIA_TIMEOUT_MS = 10_000;
// A function, not a frozen constant, the same shape `voiceCatalogUrl()`
// already uses for its own fixed third-party URL: MAIPAI_WIKIPEDIA_BASE_URL
// lets a test point this at a local fixture instead of the real
// en.wikipedia.org, never read outside a test (nothing sets it in any
// real deployment).
function wikipediaBaseUrl(): string {
  return process.env.MAIPAI_WIKIPEDIA_BASE_URL ?? "https://en.wikipedia.org";
}

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
      const response = await packageFetch(currentUrl, { method: currentMethod, headers, body: currentBody, signal: controller.signal, redirect: "manual" });
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
        // #92: a 404 (or a 410) is the typed "not found" of
        // spec/errors/errors.json, not an unreachable network: the host
        // answered and the resource does not exist. A Tier 0 pattern
        // winner reporting it falls through to the model
        // (turnEngine.ts's prepareTurn()); every other status stays the
        // upstream failure it is.
        const code = response.status === 404 || response.status === 410 ? "not_found" : "network_unreachable";
        return {
          ok: false,
          networkFailure: false,
          status: response.status,
          error: new HostError(code, `${url} returned HTTP ${response.status}`),
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

// attemptHttpFetch's own fallback for a non-JSON body is the raw text (a
// real API answering plain text/HTML is not a host.fetch failure in
// general), but every caller here expects a real JSON object back - that
// shape only breaks when the configured URL redirected somewhere that
// isn't the real API at all (an SSO login page, most often). Found live
// 2026-09-06 for SearXNG specifically (a URL behind PocketID SSO
// silently became "No web search results were found." instead of a real,
// fixable error) - Home Assistant's own `home.base_url` is the identical
// shape (a household-configured URL to a self-hosted service) and has
// the same latent gap, just not yet hit live the way SearXNG's was.
//
// Checks "is this object-shaped," not "did attemptHttpFetch's JSON.parse
// actually succeed" (a code review, 2026-09-06, flagged the difference) -
// attemptHttpFetch doesn't report which of its two branches produced a
// value, so this can't tell a real API's own top-level array/string/
// number response apart from the raw-text fallback. Both of today's
// callers (Home Assistant's `/api/states/<id>`, SearXNG's own
// `/search?format=json`) always answer with a top-level object, so this
// is a real caveat for a future caller only: reaching for this helper
// against an API whose real JSON response isn't an object needs a
// different check, not this one.
function expectJsonObject(value: unknown, baseUrl: string, hint: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostError("network_unreachable", `${baseUrl} didn't return a JSON response - ${hint}`);
  }
  return value as Record<string, unknown>;
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
  if (result.ok) return expectJsonObject(result.value, baseUrl, "check the Home Assistant URL in Settings (a URL that redirects to a login page looks like this)");
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

/** The settings lookup and rate limit for `host.integration.call("searxng",
 * "search", ...)` - the same "isn't set up yet" shape
 * `requireHomeAssistantSettings()` established, one setting instead of
 * two since SearXNG's default JSON API needs no credential. */
function requireSearxngSettings(): { baseUrl: string } {
  const baseUrl = getHouseholdSettingValue("search.searxng_url") as string | undefined;
  if (!baseUrl) {
    throw new HostError("invalid_input", "Web search isn't set up yet - add a SearXNG URL in Settings first");
  }
  if (!tryConsume(SEARXNG_RATE_LIMIT_KEY, SEARXNG_RATE_LIMIT)) {
    throw new HostError("rate_limited", "Web search is rate-limited - try again shortly");
  }
  return { baseUrl };
}

interface SearxngResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

interface SearxngInfobox {
  infobox?: unknown;
  id?: unknown;
  content?: unknown;
  urls?: unknown;
}

/** Formats SearXNG's own `/search?format=json` response into a single
 * readable string - a numbered list, title/url/snippet per result - not
 * the raw JSON. The recipe language has no loop or array-map primitive
 * (the same reason `recall`'s own step resolves its top matches into one
 * ready-to-use string at the interpreter rather than binding a raw array
 * for a `format` step that can't iterate it), so this does the identical
 * "resolve the list-shaped result into a string at the source" move -
 * ready for a `llm_complete` step to summarize into a real answer, or a
 * `format` step to show as-is. Every field type-checked (not just
 * existence) before use - the same gap class code review found in
 * almanac-holiday/onthisday/music: a malformed entry is skipped, never
 * interpolated as "undefined". */
// A code review (2026-09-06) found no cap on a result's own title/
// content length before it lands in an `llm_complete` prompt (websearch's
// own recipe) - a misbehaving instance or a page with a huge meta-
// description could otherwise splice hundreds of KB of arbitrary,
// household-uncontrolled text into a single model call. Truncated, not
// rejected: a long real title/snippet is still useful information, only
// an implausibly long one is actually a problem.
const SEARXNG_FIELD_MAX_CHARS = 300;

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

// A direct-topic query ("Japan", "Grand Theft Auto VI") doesn't land in
// SearXNG's `results` array at all - Wikipedia (and similarly
// knowledge-panel-style engines) answers those with a single `infoboxes`
// entry instead, which this function used to never read, so the exact
// queries most likely to have a good one-line answer came back "No web
// search results were found." An infobox's own `title` field is blank
// (the real name is in `infobox`), and its primary link is `id`, not
// `url` (that's null on an infobox) - `urls[0]` is the fallback for the
// rare case `id` is missing.
function formatInfobox(raw: unknown): string | null {
  const box = raw as SearxngInfobox;
  if (typeof box?.infobox !== "string" || box.infobox.length === 0) return null;
  const firstUrl = Array.isArray(box.urls) ? (box.urls[0] as { url?: unknown } | undefined)?.url : undefined;
  const url = typeof box.id === "string" ? box.id : typeof firstUrl === "string" ? firstUrl : undefined;
  const title = truncate(box.infobox, SEARXNG_FIELD_MAX_CHARS);
  const content = typeof box.content === "string" && box.content.length > 0 ? ` - ${truncate(box.content, SEARXNG_FIELD_MAX_CHARS)}` : "";
  return url ? `${title} (${url})${content}` : `${title}${content}`;
}

function formatResult(raw: unknown): string | null {
  const result = raw as SearxngResult;
  if (typeof result?.title !== "string" || typeof result?.url !== "string") return null;
  const title = truncate(result.title, SEARXNG_FIELD_MAX_CHARS);
  const content = typeof result.content === "string" && result.content.length > 0 ? ` - ${truncate(result.content, SEARXNG_FIELD_MAX_CHARS)}` : "";
  return `${title} (${result.url})${content}`;
}

// Shared by both of formatSearxngResults's passes (infoboxes first, then
// results) - identical bounds-check/format/skip/number/push shape, only
// the formatter and the source array differ. `n`/`lines` thread through
// so the count cap and numbering are shared across both passes, not
// reset per array.
function appendFormatted(items: unknown, count: number, n: number, lines: string[], format: (raw: unknown) => string | null): number {
  if (!Array.isArray(items)) return n;
  for (const raw of items) {
    if (n >= count) break;
    const formatted = format(raw);
    if (!formatted) continue;
    n += 1;
    lines.push(`${n}. ${formatted}`);
  }
  return n;
}

// Exported (a code review, 2026-09-07, found lib/searxngHealth.ts's own
// zero-results detection duplicating this as an inline string literal) so
// a future reword/i18n here can't silently break that check with no test
// pointing at the real cause.
export const SEARXNG_NO_RESULTS_TEXT = "No web search results were found.";

export function formatSearxngResults(data: unknown, count = 5): string {
  const parsed = data as { results?: unknown; infoboxes?: unknown } | null;
  const lines: string[] = [];
  const n = appendFormatted(parsed?.infoboxes, count, 0, lines, formatInfobox);
  appendFormatted(parsed?.results, count, n, lines, formatResult);
  return lines.length > 0 ? lines.join("\n") : SEARXNG_NO_RESULTS_TEXT;
}

type SearxngSearchResult = { text: string; rows: { title: string; url: string; snippet: string | null; image?: string | null; thumbnail?: string | null }[]; page?: PageReadResult };

/** SEARCH-FALLBACK-01: Wikipedia's own official, documented REST API,
 * search then the page summary - "search" (the Core REST API,
 * `MediaWiki API:REST_API/Reference`, `/w/rest.php/v1/search/page`)
 * finds the matching article; "page summary" (the Page Content
 * Service, `/api/rest_v1/page/summary/<title>`, verified live
 * 2026-09-24 against `en.wikipedia.org/api/rest_v1/page/summary/Jupiter`)
 * gives the actual extract to answer from, with `content_urls.desktop.page`
 * as the citable source. `null` on any failure (no match, no network,
 * an unparseable response, an empty extract) - the caller's own signal
 * to fall back to `searxngSearch()`'s original outcome unchanged, never
 * masking a real SearXNG problem with a worse, silent Wikipedia miss.
 * `FETCH_USER_AGENT` (already `"MaiPai-Home/1.0 (+https://github.com/
 * getmaipai/home)"`, the org's own product URL, no personal contact)
 * matches Wikimedia's own User-Agent policy (`foundation.wikimedia.org/
 * wiki/Policy:User-Agent_policy`, verified 2026-09-24): "<client name>/
 * <version> (<contact information>)", a website URL being one of its
 * own explicitly-accepted contact forms - a non-compliant request risks
 * a 403 ("Scripts should use an informative User-Agent string with
 * contact information, or they may be blocked without notice") or
 * silent throttling, the policy's own words. */
/** One rate-limited, User-Agent-compliant GET against a Wikipedia REST
 * endpoint, parsed as a JSON object - `null` on any failure (budget
 * spent, network, non-JSON), the identical "the caller falls back"
 * contract `wikipediaFallback()` itself uses. Factored out (a review,
 * 2026-09-24) since the search call and the summary call below were
 * an identical copy of this same four-step sequence, which a future
 * change (a retry, a different null convention) would otherwise have
 * to make twice and could silently drift between. */
async function wikipediaGetJson(url: string, base: string, hint: string): Promise<Record<string, unknown> | null> {
  if (!tryConsume(WIKIPEDIA_RATE_LIMIT_KEY, WIKIPEDIA_RATE_LIMIT)) return null;
  const result = await attemptHttpFetch(url, "GET", { "user-agent": FETCH_USER_AGENT }, undefined, WIKIPEDIA_TIMEOUT_MS);
  if (!result.ok) return null;
  try {
    return expectJsonObject(result.value, base, hint);
  } catch {
    return null;
  }
}

// SEARCH-SAFE-01 finding, not fixed here: Wikipedia's own REST API
// (`/w/rest.php/v1/search/page`, `/api/rest_v1/page/summary/...`, both
// called below) takes no safe-search or content-rating parameter at
// all - unlike SearXNG, Wikipedia has no per-request filter to pass a
// child or teen's band into. This fallback runs identically regardless
// of who is asking; Wikipedia's own content policy (no dedicated
// "child mode") is the only floor, not anything this file controls.
async function wikipediaFallback(query: string): Promise<SearxngSearchResult | null> {
  const base = wikipediaBaseUrl();
  const searchUrl = `${base}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`;
  const searchValue = await wikipediaGetJson(searchUrl, base, "Wikipedia's search API didn't return JSON");
  if (!searchValue) return null;
  const pages = Array.isArray(searchValue.pages) ? searchValue.pages : [];
  const top = pages[0] as { key?: unknown } | undefined;
  if (!top || typeof top.key !== "string" || top.key.length === 0) return null;

  const summaryUrl = `${base}/api/rest_v1/page/summary/${encodeURIComponent(top.key)}`;
  const summary = await wikipediaGetJson(summaryUrl, base, "Wikipedia's summary API didn't return JSON");
  if (!summary) return null;
  const rawExtract = typeof summary.extract === "string" ? summary.extract.trim() : "";
  if (!rawExtract) return null;
  const title = typeof summary.title === "string" && summary.title.length > 0 ? summary.title : top.key;
  const contentUrls = summary.content_urls as { desktop?: { page?: unknown } } | undefined;
  const pageUrl = typeof contentUrls?.desktop?.page === "string" ? contentUrls.desktop.page : `${base}/wiki/${encodeURIComponent(top.key)}`;
  // A review, 2026-09-24, caught two real gaps: the extract had no
  // length cap at all (every other SearXNG-sourced field this file
  // returns is bounded by SEARXNG_FIELD_MAX_CHARS), and the row's own
  // snippet duplicated the full extract byte for byte with `page.text`
  // below, doubling the tokens an `llm_complete` synthesis call pays
  // for the identical content twice. `description` (Wikidata's own
  // short summary, "Fifth planet from the Sun" for Jupiter) is the row
  // snippet when Wikipedia gives one - a real, different sentence from
  // the extract, not a duplicate; `page.text` gets the same 32,000-char
  // bound `parseReadablePage()` already uses for a real fetched page's
  // own text, since this is standing in for exactly that.
  const description = typeof summary.description === "string" ? summary.description.trim() : "";
  const snippet = truncate(description || rawExtract, SEARXNG_FIELD_MAX_CHARS);
  const pageText = rawExtract.slice(0, 32_000);

  const row = { title, url: pageUrl, snippet };
  return {
    text: `1. ${title} (${pageUrl}) - ${snippet}`,
    rows: [row],
    page: { type: "document", attachment_id: pageAttachmentId(pageUrl), url: pageUrl, title, text: pageText, chunks: [], links: [], sections: [] },
  };
}

interface SearxngEngine {
  name: string;
  enabled: boolean;
  safesearch: boolean;
  categories: string[];
}

// SEARCH-SAFE-01: SearXNG's own `/config` (verified live against a real
// household instance, 2026-09-24 - the shape a fixture, tests/fixtures/
// searxng-config.json, carries two real engine entries from that read).
// Cached per base URL: this never changes on its own (an admin edits
// settings.yml and restarts SearXNG to change it), so a child or teen's
// every search does not cost a second real request first - "never a
// live fetch in the request path" is this module's own standing rule
// (packageCache.ts's header) for exactly this reason.
const SEARXNG_ENGINES_CACHE_TTL_MS = 60 * 60 * 1000;
let searxngEnginesCache: { baseUrl: string; fetchedAt: number; engines: SearxngEngine[] } | null = null;

/** Test-only reset, the same shape every other module-level cache here
 * gets (__resetRateLimiterForTests, __resetPackageCacheForTests): a
 * fake server's own port changes every test, so a cached engines list
 * from a prior test's own fake instance must never leak into the next. */
export function __resetSearxngEnginesCacheForTests(): void {
  searxngEnginesCache = null;
}

/** The engine names this instance's own `/config` marks `enabled` and
 * `safesearch`-capable for the given category, for a child or teen's
 * request to name explicitly (SearXNG's own `engines=` parameter) -
 * `safesearch=2` alone does not exclude an engine that simply has no
 * safe-search support of its own; verified against a real instance,
 * 2026-09-24. Returns `null` on any fetch or parse failure (a child's
 * search still runs, on the safesearch level alone, never blocked
 * outright over a filter this could not build) or an empty array when
 * the instance genuinely has no safe-search-capable engine for this
 * category - the caller treats both the same way. */
async function safesearchEnginesFor(baseUrl: string, category: "general" | "images"): Promise<string[] | null> {
  const now = Date.now();
  if (!searxngEnginesCache || searxngEnginesCache.baseUrl !== baseUrl || now - searxngEnginesCache.fetchedAt > SEARXNG_ENGINES_CACHE_TTL_MS) {
    const url = `${baseUrl.replace(/\/+$/, "")}/config`;
    const result = await attemptHttpFetch(url, "GET", {}, undefined, SEARXNG_TIMEOUT_MS);
    if (!result.ok) return null;
    let value: Record<string, unknown>;
    try {
      value = expectJsonObject(result.value, baseUrl, "SearXNG's /config didn't return JSON");
    } catch {
      return null;
    }
    const raw = Array.isArray(value.engines) ? value.engines : [];
    const engines: SearxngEngine[] = raw.flatMap((e: unknown) => {
      const entry = e as { name?: unknown; enabled?: unknown; safesearch?: unknown; categories?: unknown };
      if (typeof entry.name !== "string" || typeof entry.enabled !== "boolean" || typeof entry.safesearch !== "boolean" || !Array.isArray(entry.categories)) return [];
      return [{ name: entry.name, enabled: entry.enabled, safesearch: entry.safesearch, categories: entry.categories.filter((c): c is string => typeof c === "string") }];
    });
    searxngEnginesCache = { baseUrl, fetchedAt: now, engines };
  }
  return searxngEnginesCache.engines.filter((e) => e.enabled && e.safesearch && e.categories.includes(category)).map((e) => e.name);
}

/** `host.integration.call("searxng", "search", { query })`'s real
 * implementation - SearXNG's own `/search?q=...&format=json` (its
 * documented JSON output format, opt-in in a household's own
 * settings.yml the same way a Home Assistant access token is opt-in on
 * their side). Verified 2026-09-06 against a real running SearXNG
 * instance - found and fixed two real gaps in the process (both covered
 * below): a URL sitting behind SSO returns its login page rather than
 * JSON, which `attemptHttpFetch` treats as a normal successful response
 * (a real API answering plain text is not a fetch failure); and Wikipedia
 * answers a direct-topic query via `infoboxes`, not `results` (see
 * `formatSearxngResults`). */
export async function searxngSearch(args: unknown, opts: { allowWikipediaFallback?: boolean; safeSearchLevel?: SafeSearchLevel } = {}): Promise<SearxngSearchResult> {
  // SEARCH-FALLBACK-01: `opts` is never part of the recipe's own public
  // `args` schema (a model can never set it) - the one caller that
  // needs to turn the fallback off is `searxngHealth.ts`'s own canary,
  // which calls this function directly, never through `integration.call`.
  // A review, 2026-09-24, caught the first cut always allowing the
  // fallback: the canary's own "Earth" query, chosen specifically
  // because it is "guaranteed to return something," meant a genuine
  // SearXNG outage got silently answered by Wikipedia instead, then
  // read back as `ok` and resolved the very issue this same call had
  // just raised one line earlier - defeating SEARCH-HEALTH-01's own
  // detection, built the same day, for the one caller whose whole job
  // is detecting exactly that.
  const allowWikipediaFallback = opts.allowWikipediaFallback ?? true;
  const input = args as { query?: unknown; category?: unknown; read_page?: unknown } | undefined;
  const query = input?.query;
  if (typeof query !== "string" || query.length === 0) {
    throw new HostError("invalid_input", `searxng search needs a string "query" argument`);
  }
  const { baseUrl } = requireSearxngSettings();
  const isImages = input?.category === "images";
  const category = isImages ? "&categories=images" : "";
  // SEARCH-SAFE-01 (Jesse's own ruling, 2026-09-24, superseding the
  // age-band-only first cut): today's request carried no safesearch
  // level at all, so a child's search ran exactly as unfiltered as an
  // adult's. The real level is `search.safe_search`, a per-person
  // setting (commons spec) resolved against the speaker's own band when
  // it is "default" - `createHost`'s own `actor` is the one source,
  // resolved there and threaded through as `opts.safeSearchLevel`
  // (never trusted from a package's own args, the same floor as
  // `category` above). Default by band: child strict, teen moderate,
  // adult off - an adult may choose their own; only an adult may change
  // a child's or teen's (settings.ts's own `assertCanSetSafeSearch`); a
  // child or teen can never loosen their own below their band default,
  // enforced at write time, not read time. No image floor: images
  // follow the person's own level like everything else, on the
  // owner's own instruction this session, withdrawing the first cut's
  // floor. An absent level (the health canary's own direct call, never
  // a household turn) defaults to off - it never resolves to a real
  // reply, so there is no household member to protect.
  const safesearchLevel = safeSearchNumericLevel(opts.safeSearchLevel ?? "off");
  // Only "strict" and "moderate" also name safe engines explicitly;
  // "off" is a real, deliberate choice for this person and gets no
  // engine filter at all. For strict/moderate, name only the engines
  // this instance's own /config marks safesearch-capable and enabled,
  // for the category this request actually runs (SearXNG excludes
  // nothing on its own when an enabled engine simply doesn't support
  // the level sent - verified against a real household instance's
  // /config, 2026-09-24: `engines` is an array of {name, enabled,
  // safesearch, categories, ...}, no other field names this). The
  // safesearch level above is still sent and still the floor even when
  // this list is empty or unavailable - never blocking a search
  // outright over a filter that couldn't be built.
  const safeEngines = opts.safeSearchLevel === "strict" || opts.safeSearchLevel === "moderate" ? await safesearchEnginesFor(baseUrl, isImages ? "images" : "general") : null;
  const engines = safeEngines && safeEngines.length > 0 ? `&engines=${encodeURIComponent(safeEngines.join(","))}` : "";
  const url = `${baseUrl.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json${category}&safesearch=${safesearchLevel}${engines}`;
  // No retry, unlike getHomeAssistantState's own GET - a code review
  // (2026-09-06) found the retry doubled this call's own worst case to
  // ~20s (SEARXNG_TIMEOUT_MS twice plus the retry delay) on top of
  // `llm_complete`'s own real inference time, still ahead of it in the
  // same recipe. A slow SearXNG round trip (it fans out to several real
  // engines and waits on the slowest) is a real answer taking a while,
  // not the transient blip a retry is meant to paper over the way a
  // flaky LAN hop to Home Assistant is - retrying it just waits twice as
  // long for the identical result.
  // SEARCH-HEALTH-01 (docs/dev.md, docs/plans/search-resilience-
  // 2026-09-24.md): "the one choke point (packageHost.ts searxngSearch)
  // records [search's state] on each call" - wraps the real SearXNG
  // network work below (the search request and its response only) so
  // every real outcome, success or failure, updates the same Repairs
  // rows `searxngHealth.ts`'s own periodic canary already uses
  // (`searchHealthState.ts`'s shared `recordSearchHealth()`), never
  // waiting for the next scheduled probe to notice a live person's own
  // search just failed or just started working again. A self-imposed
  // `rate_limited` throw is never a health signal - it means WE chose
  // not to send the request, not that SearXNG itself is having
  // trouble - so it is excluded and rethrown unchanged. Deliberately
  // does NOT wrap the `read_page` fetch below: fetching an arbitrary
  // linked page can fail for reasons that have nothing to do with
  // SearXNG at all (the target site blocking the request, non-HTML
  // content, its own rate limit) - a review, 2026-09-24, caught the
  // first cut of this wrapping that fetch too, misreporting SearXNG as
  // down over a problem on some other site entirely.
  let text: string;
  let rows: { title: string; url: string; snippet: string | null; image?: string | null; thumbnail?: string | null }[];
  try {
    const result = await attemptHttpFetch(url, "GET", {}, undefined, SEARXNG_TIMEOUT_MS);
    if (result.ok) {
      const value = expectJsonObject(
        result.value,
        baseUrl,
        "check the SearXNG URL in Settings (a URL that redirects to a login page, or an instance with JSON output disabled, both look like this)",
      );
      rows = Array.isArray(value.results) ? value.results.slice(0, 8).flatMap((raw: unknown) => {
        const row = raw as { title?: unknown; url?: unknown; content?: unknown; img_src?: unknown; thumbnail_src?: unknown };
        if (typeof row.title !== "string" || typeof row.url !== "string") return [];
        try { const parsed = new URL(row.url); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return []; parsed.username = ""; parsed.password = ""; parsed.hash = ""; const safeUrl = (value: unknown) => { if (typeof value !== "string") return null; try { const parsed = new URL(value); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null; parsed.username = ""; parsed.password = ""; parsed.hash = ""; return parsed.toString(); } catch { return null; } }; return [{ title: row.title, url: parsed.toString(), snippet: typeof row.content === "string" ? row.content : null, ...(input?.category === "images" ? { image: safeUrl(row.img_src), thumbnail: safeUrl(row.thumbnail_src) } : {}) }]; } catch { return []; }
      }) : [];
      text = formatSearxngResults(value);
      // SEARCH-EMPTY-01 (docs/dev.md, docs/plans/search-resilience-
      // 2026-09-24.md): SearXNG already reports the problem on every
      // response - `unresponsive_engines`, an array of `[engine name,
      // reason]` pairs ("Suspended: too many requests", "Suspended:
      // CAPTCHA") for every upstream engine it could not use this
      // request. Genuinely nothing to answer from (the same
      // `SEARXNG_NO_RESULTS_TEXT` signal `formatSearxngResults` already
      // computes across BOTH `results` and `infoboxes` - never re-derived
      // narrower here, which would wrongly fail a real infobox-only answer
      // just because some other, unrelated engine was also suspended)
      // with at least one suspended engine is search actually failing,
      // not a real "nothing found". The exact gap the live household
      // conversation (conv-19awhetzdf, 2026-09-24) fell into: an empty
      // result read as a plain "succeeded" outcome, and the phrasing
      // round answered from its own knowledge instead, wrongly and
      // confidently. Thrown here, the one choke point every websearch
      // call already passes through, rather than checked per caller.
      const unresponsiveEngines = Array.isArray(value.unresponsive_engines)
        ? value.unresponsive_engines.some((raw: unknown) => Array.isArray(raw) && typeof raw[0] === "string")
        : false;
      if (text === SEARXNG_NO_RESULTS_TEXT && unresponsiveEngines) {
        // This exact message reaches a household member verbatim only
        // because `turnMachine/nodes/answer.ts`'s `toolOutageLine()`
        // recognizes the "search_unavailable" code by name and delivers
        // it directly, bypassing the generic COMPOSE_FAILURE_LINE swap
        // every other failed outcome gets - a review, 2026-09-24, flagged
        // that the two are in different files with nothing mechanical
        // tying them together. Adding a new safe, hand-written HostError
        // message anywhere else in this file (or another integration)
        // needs a matching branch added there, or it silently gets the
        // generic line instead.
        throw new HostError("search_unavailable", "Search isn't working right now.");
      }
      // SEARCH-FALLBACK-01: "when SearXNG is down or returns nothing" -
      // the "returns nothing" half. A genuinely empty result with no
      // engine trouble is never a health problem (SEARCH-EMPTY-01's own
      // distinction, unchanged) - it just, on its own, has nothing to
      // answer a household member's question from, and Wikipedia is
      // one more real chance to before giving up.
      if (text === SEARXNG_NO_RESULTS_TEXT && allowWikipediaFallback) {
        const fallback = await tryWikipediaFallback(query);
        if (fallback) {
          // A review, 2026-09-24, caught the first cut returning here
          // before this call - SearXNG really did just answer "ok"
          // (empty, but no engine trouble), and skipping this meant a
          // real recovery (an issue open from a PRIOR call) never got
          // resolved just because Wikipedia happened to have this
          // one query's own answer.
          await recordSearchHealth({ kind: "ok" });
          return fallback;
        }
      }
    } else {
      throw result.error;
    }
  } catch (err) {
    if (err instanceof HostError && err.code === "rate_limited") throw err;
    if (err instanceof HostError && err.code === "search_unavailable") {
      await recordSearchHealth({
        kind: "degraded",
        detail: "SearXNG reports its own search engines are currently suspended (too many requests, or a CAPTCHA) - this usually clears on its own within a while. If it doesn't, check which engines are enabled in SearXNG's own settings.",
      });
    } else {
      await recordSearchHealth({
        kind: "down",
        detail: `${err instanceof Error ? err.message : String(err)} Check the SearXNG URL in Settings -> AI & connections -> Integrations.`,
      });
    }
    // SEARCH-FALLBACK-01: "when SearXNG is down" - the other half. Tried
    // AFTER recording SearXNG's own real health (a household still needs
    // to know SearXNG itself is broken, whether or not Wikipedia happens
    // to answer this one question) and never for a self-imposed
    // rate_limited throw (excluded above, before this point - that means
    // WE chose not to send the request, not that SearXNG failed), and
    // never for any error OTHER than a confirmed network/availability
    // failure (`network_unreachable`, `search_unavailable`) - a review,
    // 2026-09-24, caught the first cut falling back for ANY thrown
    // error, including a genuine bug in the parsing above (a future
    // regression in `expectJsonObject`/`formatSearxngResults`/the row
    // mapping), which would have silently masked a real code defect as
    // a clean Wikipedia answer instead of the loud failure a bug needs.
    if (allowWikipediaFallback && err instanceof HostError && (err.code === "network_unreachable" || err.code === "search_unavailable")) {
      const fallback = await tryWikipediaFallback(query);
      if (fallback) return fallback;
    }
    throw err;
  }
  await recordSearchHealth({ kind: "ok" });
  // Never wrapped in the try/catch above (this function's own header
  // comment says why): a page-read failure is never a SearXNG health
  // signal, so it propagates to this call's own caller unchanged.
  const page = input?.read_page === true && rows[0] ? await searxngPageRead({ url: rows[0].url }) : undefined;
  return { text, rows, ...(page ? { page } : {}) };
}

/** SEARCH-FALLBACK-01's own gate: `search.wikipedia_fallback` (default
 * true, `searchKeys.ts`) - a household can turn this off independently
 * of web search itself, though it only ever runs when web search is
 * already configured and already failed or found nothing (this
 * function is only ever called from inside `searxngSearch()`, which
 * itself already refused to run at all if `search.searxng_url` were
 * unset). `null` on any failure, the identical "the caller falls back
 * to what it already had" contract `wikipediaFallback()` itself uses. */
async function tryWikipediaFallback(query: string): Promise<SearxngSearchResult | null> {
  const enabled = getHouseholdSettingValue("search.wikipedia_fallback") as boolean | undefined;
  if (enabled === false) return null;
  return wikipediaFallback(query);
}

export interface PageReadLink {
  title: string;
  href: string;
  rel: string | null;
  surrounding_text: string | null;
}

export interface PageReadSection {
  heading: string;
  text: string;
}

export interface PageReadResult {
  type: "document";
  attachment_id: string;
  url: string;
  title: string;
  text: string;
  chunks: { attachment_id: string; page: number; text: string }[];
  links: PageReadLink[];
  sections: PageReadSection[];
}

let pageReaderForTests: ((url: string) => Promise<PageReadResult>) | null = null;

export function __setPageReaderForTests(reader: ((url: string) => Promise<PageReadResult>) | null): void {
  pageReaderForTests = reader;
}

function pageAttachmentId(url: string): string {
  return `att-page-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

async function validatePublicPageUrl(value: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HostError("invalid_input", "page.read needs a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new HostError("invalid_input", "page.read only supports http and https URLs");
  try {
    await assertNotPrivateHost(parsed.hostname);
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw new HostError("invalid_input", err.message);
    throw new HostError("network_unreachable", `could not resolve ${parsed.hostname}`);
  }
}

function robotsAllows(robots: string, target: URL): boolean {
  let applies = false;
  let allowed = true;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "user-agent") applies = value === "*";
    else if (applies && name === "disallow" && value && target.pathname.startsWith(value)) allowed = false;
    else if (applies && name === "allow" && value && target.pathname.startsWith(value)) allowed = true;
  }
  return allowed;
}

async function pageFetch(url: string): Promise<AttemptResult> {
  if (!tryConsume(SEARXNG_PAGE_RATE_LIMIT_KEY, SEARXNG_PAGE_RATE_LIMIT)) throw new HostError("rate_limited", "Web pages are rate-limited - try again shortly");
  await validatePublicPageUrl(url);
  return attemptHttpFetch(
    url,
    "GET",
    { accept: "text/html,application/xhtml+xml" },
    undefined,
    SEARXNG_TIMEOUT_MS,
    async (hopUrl) => validatePublicPageUrl(hopUrl),
  );
}

function pageFailure(result: AttemptResult, url: string): never {
  if (result.status === 403 || result.status === 429) throw new HostError("network_unreachable", `The site declined the page request for ${url}.`);
  throw result.error ?? new HostError("network_unreachable", `could not reach ${url}`);
}

/** Parse one fetched page without making another network request. Kept
 * separate so the bounded document and link contract can be tested with a
 * scripted page, independent of DNS and the public-host guard. */
export function parseReadablePage(html: string, url: string): PageReadResult {
  const sourceDocument = parseHTML(html).document as any;
  const article = new Readability(sourceDocument).parse();
  const readableDocument = article?.content ? parseHTML(article.content).document as any : sourceDocument;
  const attachmentId = pageAttachmentId(url);
  const text = String(article?.textContent ?? readableDocument.body?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 32_000);
  if (!text) throw new HostError("network_unreachable", `The page at ${url} did not contain readable text.`);
  const links: PageReadLink[] = Array.from(readableDocument.querySelectorAll("a")).slice(0, 64).flatMap((node: any) => {
    const rawHref = node.getAttribute("href");
    const title = String(node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!rawHref || !title) return [];
    try {
      const href = new URL(rawHref, url);
      if (href.protocol !== "http:" && href.protocol !== "https:") return [];
      href.username = "";
      href.password = "";
      href.hash = "";
      const parentText = String(node.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim();
      return [{ title: title.slice(0, 300), href: href.toString(), rel: node.getAttribute("rel"), surrounding_text: parentText ? parentText.slice(0, 500) : null }];
    } catch {
      return [];
    }
  });
  const sections: PageReadSection[] = Array.from(readableDocument.querySelectorAll("h1,h2,h3")).slice(0, 8).flatMap((node: any) => {
    const heading = String(node.textContent ?? "").replace(/\s+/g, " ").trim();
    let sibling = node.nextElementSibling;
    while (sibling && !String(sibling.textContent ?? "").trim()) sibling = sibling.nextElementSibling;
    const sectionText = String(sibling?.querySelector?.("p")?.textContent ?? sibling?.textContent ?? "").replace(/\s+/g, " ").trim();
    return heading && sectionText ? [{ heading: heading.slice(0, 300), text: sectionText.slice(0, 1200) }] : [];
  });
  return {
    type: "document",
    attachment_id: attachmentId,
    url,
    title: String(article?.title ?? sourceDocument.title ?? url).trim().slice(0, 300),
    text,
    chunks: [{ attachment_id: attachmentId, page: 1, text: text.slice(0, 4_000) }],
    links,
    sections,
  };
}

/** Read one user-requested page through the same SearXNG service budget.
 * Linkedom is ISC-licensed and Mozilla Readability is Apache-2.0, both
 * compatible with this AGPL-3.0 package. Cheerio plus an HTML-to-text
 * helper was rejected because it would leave article extraction as a
 * second parser surface. */
export async function searxngPageRead(args: unknown): Promise<PageReadResult> {
  const url = (args as { url?: unknown } | undefined)?.url;
  if (typeof url !== "string" || url.length === 0) throw new HostError("invalid_input", "page.read needs a string \"url\" argument");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new HostError("invalid_input", "page.read needs a valid URL");
  }
  if (pageReaderForTests) return pageReaderForTests(url);
  const origin = parsedUrl.origin;
  const robotsResult = await pageFetch(`${origin}/robots.txt`);
  if (!robotsResult.ok && robotsResult.status !== 404) pageFailure(robotsResult, `${origin}/robots.txt`);
  if (robotsResult.ok && typeof robotsResult.value === "string" && !robotsAllows(robotsResult.value, parsedUrl)) {
    throw new HostError("network_unreachable", `The site's robots.txt declined the page request for ${url}.`);
  }
  const result = await pageFetch(url);
  if (!result.ok) pageFailure(result, url);
  if (typeof result.value !== "string") throw new HostError("network_unreachable", `The site did not return readable HTML for ${url}.`);
  return parseReadablePage(result.value, url);
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

function mapWriteFailure(status: number, error: string): never {
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
 * `package:<id>`, unchanged from before this parameter existed.
 * `turn.conversationId` rides along on the same object rather than as
 * its own positional parameter (a code review, 2026-09-21: two
 * adjacent same-typed optional strings have no runtime cross-check, so
 * a future call site could silently pass one turn's id with a
 * different turn's conversation) - every real caller already has both
 * together in scope (the conversation a turn belongs to), so building
 * one object at the call site is the natural shape, not friction added
 * for its own sake. */
export function createHost(actor: PersonRow, manifest: PackageManifest, secrets: readonly string[] = [], turn?: { id: string; conversationId?: string }): Host {
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
        // Conversational package recall is turn-scoped: a person gets their
        // own person memories plus authorized household memories, while an
        // owner/admin does not accidentally pull a child's private facts
        // into ordinary chat. Explicit parental inspection uses the memory
        // routes, not this package port.
        const listOpts: memory.ListOptions = { selfOnly: true };
        if (opts?.scope === "household" || opts?.scope === "person" || opts?.scope === "self") {
          listOpts.scope = opts.scope;
        }
        if (opts?.person) {
          if (opts.person !== actor.id) {
            throw new HostError("permission_denied", "packages cannot recall another person's memories");
          }
          listOpts.person = actor.id;
        }
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
        const source = turn?.id ?? `package:${manifest.id}`;
        if (turn?.id) logEntry("info", "remembered via turn", { turn_id: turn.id });
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
    // ARTIFACT-02: the sanctioned way a Tier 0 recipe writes a live chat
    // artifact-card/canvas-split document (docs/dev.md's "ARTIFACT-02,
    // designed"). Synchronous like memory.remember, not fetch: backed by
    // lib/artifacts.ts's own synchronous SQLite writer, nothing to await.
    artifact: {
      create(input: { title: string; kind: string; body: string }): { id: string; version: number } {
        requirePermission("artifact:write");
        // turn_id is a required FK on the Artifact record (artifact.schema.json)
        // - unlike memory.remember's own free-text `source`, there is no
        // fallback shape for "no turn": a live chat artifact always has
        // one. `turn.conversationId` is passed straight from the
        // caller's own in-flight turn context (turnEngine.ts already
        // has it every place it calls runPlugin() with a turn id),
        // never looked up from conversationTurns: that row is written
        // by logTurn() only once the WHOLE turn finishes composing,
        // well after any tool outcome (including this one) has already
        // run - a DB lookup here always missed for a real live turn,
        // the only turn this ever runs on (found live, 2026-09-21,
        // verifying SHELL-02 slice 4: every test that passed before
        // this fix had pre-inserted the row itself,
        // packageHostArtifact.test.ts's own turnFor(), which no real
        // turn ever does up front). getmaipai/home#131 closed the
        // deeper gap this fix alone didn't: `createArtifact()` below
        // used to fail its own foreign-key constraint against
        // conversationTurns, since that row genuinely didn't exist yet
        // at this point in a real turn - turnEngine.ts's `prepareTurn()`
        // now writes a real, minimal row for this exact turn id before
        // anything else runs (conversationHistory.ts's
        // `insertProvisionalTurn()`), so the FK this insert needs is
        // always satisfied by the time any tool outcome, this one
        // included, can possibly run.
        if (!turn?.id || !turn.conversationId) {
          throw new HostError("not_found", "host.artifact.create needs a conversation turn to attach to");
        }
        // TEMP-CHAT-01: turn.id/turn.conversationId are always populated
        // for a temporary turn too (runPlugin()'s callers pass them
        // unconditionally), but insertProvisionalTurn() is deliberately
        // never called for one, so there's no conversation_turns row for
        // createArtifact()'s own FK to attach to - an uncaught FK
        // violation, not the clean refusal the missing-turn case above
        // gets. A dormant gap before this feature (nothing routed
        // `ephemeral` here in practice); TEMP-CHAT-01 turns temporary
        // conversations into something people actually use, which
        // promotes it from a dormant crash to a routine one, so it's
        // fixed here rather than left for someone to rediscover.
        // Thrown the identical way the check above already does - one
        // shape of refusal, not two - so it travels the same normal
        // declined-tool-outcome path, never an unhandled exception
        // mid-stream.
        if (isTemporaryConversation(turn.conversationId)) {
          throw new HostError("permission_denied", "Documents aren't available in a temporary chat because nothing is saved.");
        }
        // The identical provenance FIELD memory.remember() already uses
        // for its own `source` (docs/dev.md's "Provenance" note) -
        // unlike remember()'s `turnId ?? package:${manifest.id}`, there
        // is no fallback branch to write here: the throw above already
        // guarantees turn.id is bound by this point (turn_id is a
        // required FK, not a free-text field with room for a package-id
        // shaped placeholder), so provenance is always exactly the turn
        // id, never a bare `??` expression that can't actually fall
        // through (a code review flagged the misleading dead branch an
        // earlier draft carried here).
        const value = createArtifact({
          conversationId: turn.conversationId,
          turnId: turn.id,
          kind: input.kind as ArtifactValue["kind"],
          title: input.title,
          body: input.body,
          createdBy: actor.id,
          provenance: turn.id,
        });
        return { id: value.id, version: value.version };
      },
      // `kind` is deliberately absent: an existing artifact's kind never
      // changes, and recipe.schema.json's own `kind` field on this step
      // stays required regardless so the templating layer never needs an
      // optional-on-update case.
      update(input: { artifact_id: string; title: string; body: string }): { id: string; version: number } {
        requirePermission("artifact:write");
        if (!turn?.id) {
          throw new HostError("not_found", "host.artifact.update needs a conversation turn to attach to");
        }
        // TEMP-CHAT-01 (code review, 2026-09-22): the identical gap
        // create() just above was fixed for - a new version still needs
        // a real conversation_turns row for THIS turn's own id to
        // attach to (updateArtifact()'s turnId FK), and one never
        // exists for a temporary turn, whatever conversation the
        // artifact being edited originally belonged to.
        if (turn.conversationId && isTemporaryConversation(turn.conversationId)) {
          throw new HostError("permission_denied", "Documents aren't available in a temporary chat because nothing is saved.");
        }
        // lib/artifacts.ts's own updateArtifact() has no actor check at
        // all (it isn't reachable any other way - routes/artifacts.ts is
        // read-only, this host method is the one write path), so a
        // household member editing THEIR OWN artifact from a real live
        // chat could otherwise supersede anyone else's by guessing an id.
        // not_found (never permission_denied), matching
        // routes/artifacts.ts's own "can't see it, so it doesn't exist"
        // convention for someone else's artifact.
        const owned = getArtifactRow(input.artifact_id);
        if (!owned || owned.createdBy !== actor.id) {
          throw new HostError("not_found", `no artifact version ${input.artifact_id}`);
        }
        // Same provenance field as create() above, and the same reason
        // there's no `?? package:${manifest.id}` fallback: turn.id is
        // guaranteed bound by the throw above.
        const result = updateArtifact({
          currentId: input.artifact_id,
          title: input.title,
          body: input.body,
          turnId: turn.id,
          createdBy: actor.id,
          provenance: turn.id,
        });
        if (!result.ok) {
          // lib/artifacts.ts's own updateArtifact(): 404 for an unknown
          // version, 409 for one that is no longer current (editing a
          // historical version is not a supported move) - mapped to the
          // EXISTING errors.json codes host-emulator.ts's own deterministic
          // implementation already uses, not a bespoke code.
          throw new HostError(result.status === 404 ? "not_found" : "invalid_input", result.error);
        }
        // OpResult (lib/entities.ts) types `ok` as plain boolean, not a
        // discriminated literal, so the check above doesn't narrow
        // `value` away from possibly-undefined - updateArtifact() always
        // sets it on ok:true (its own last line).
        const value = result.value!;
        return { id: value.id, version: value.version };
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
      // Home Assistant (session-d-packages-and-store.md step 4) and
      // searxng (step 7, the websearch package's own case) are the two
      // integrations reachable through this generic path today - two
      // reads, neither with home.call_service's own dedicated,
      // domain-gated write shape to reuse. Every other id/method
      // combination stays capability_missing; this is deliberately not a
      // registry pattern for two entries.
      async call(id: string, method: string, args?: unknown): Promise<unknown> {
        requirePermission(`integration:${id}`);
        if (id === "home_assistant" && method === "get_state") {
          return homeAssistantGetState(args);
        }
        if (id === "searxng" && method === "search") {
          // SEARCH-SAFE-01: the real speaker's own person-scope setting,
          // resolved against their own band when it is "default" -
          // createHost's own actor is the one source of truth for who is
          // actually asking, never a package argument. getPersonSettingValue
          // reads the actor's OWN setting only (safe by construction), the
          // exact one this call needs - actor here always is the speaker.
          const safeSearchLevel = resolveSafeSearchLevel(getPersonSettingValue(actor, "search.safe_search"), speakerAgeBand(actor, new Date()));
          return searxngSearch(args, { safeSearchLevel });
        }
        if (id === "searxng" && method === "page.read") {
          return searxngPageRead(args);
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
      // The recipe interpreter's own llm_complete step (spec/interpreters/
      // ts/recipe-interpreter.ts) is the only caller today, always with a
      // single user-role message - but this reads whatever `messages`
      // array it's given, the same shape lib/llm.ts's own complete()
      // takes, so a future caller isn't boxed into a single-prompt shape.
      async complete(opts: unknown): Promise<unknown> {
        requirePermission("llm:complete");
        const messages = (opts as { messages?: unknown } | null)?.messages;
        // No shape check here beyond the cast: lib/llm.ts's own
        // complete() already validates messages (non-empty array, every
        // entry a real role/content pair) via its own validate() - a
        // second hand-maintained copy here (a code review, 2026-09-06,
        // found an earlier version doing exactly that) only had to drift
        // out of sync with it, since it checked array-non-emptiness but
        // not per-message shape the way validate() does.
        const result = await llmComplete("chat", (messages ?? []) as LlmMessage[]);
        if (!result.ok) {
          // lib/llm.ts's own error codes aren't errors.json's own
          // vocabulary - remapped to the closest real HostError code
          // rather than leaking a foreign one past this boundary (the
          // same "the host wraps errors" rule every other real method
          // here follows). `invalid_input` maps directly (identical
          // meaning); "chat" is the only role this call site ever passes
          // and lib/llm.ts's own IMPLEMENTED_ROLES has just that one
          // entry, so `unsupported_role` can't actually fire here today -
          // any other failure is a model that isn't loaded, exactly
          // errors.json's own `model_unavailable`.
          throw new HostError(result.code === "invalid_input" ? "invalid_input" : "model_unavailable", result.error);
        }
        return { text: result.value.text };
      },
    },
    camera: {
      still(): unknown {
        requirePermission("camera:still");
        notImplemented("camera.still");
      },
    },
    ocr: {
      read(image: unknown): string {
        requirePermission("ocr");
        const input = image as { bytes?: unknown; media_type?: unknown };
        const bytes = input instanceof Uint8Array ? input : input?.bytes instanceof Uint8Array ? input.bytes : null;
        if (!bytes || typeof input?.media_type !== "string") throw new HostError("invalid_input", "host.ocr.read needs image bytes and media_type");
        const result = runRapidOcr(bytes, input.media_type);
        if (!result.ok) throw new HostError(result.code, result.error);
        return result.text;
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
    // `inputs` (step 8) closes a real, previously-documented gap: this
    // used to always pass {}, so a job scheduled from a recipe's own
    // `schedule` step re-fired the package with an empty input scope.
    schedule(when: string, job: string, inputs: Record<string, unknown> = {}): string {
      requirePermission("schedule");
      const result = scheduleJob(actor, manifest.id, job, when, inputs);
      if (!result.ok) mapWriteFailure(result.status, result.error);
      return result.value.id;
    },
    lists: {
      add(text: string): void {
        requirePermission("lists:write");
        const list = findOrCreateStandingList("shopping");
        const result = addListItem(actor, list.id, { text });
        if (!result.ok) mapWriteFailure(result.status, result.error);
      },
      view(): string {
        requirePermission("lists:read");
        const list = findOrCreateStandingList("shopping");
        const items = (JSON.parse(list.items) as { text: string; done: boolean }[]).filter((i) => !i.done);
        return items.length > 0 ? items.map((i) => i.text).join(", ") : "Your shopping list is empty.";
      },
    },
    reminders: {
      // The real natural-language time/task extraction (reminderParsing.ts,
      // chrono-node) and the real scheduling both happen here - a
      // declarative recipe step can do neither for itself. Schedules a
      // "core" job (scheduleCoreJob, lib/scheduler.ts), never a "plugin"
      // one: firing later raises `remind.due` directly (CORE_JOBS'
      // `reminders.fire`), it never re-runs this recipe.
      set(text: string): { task: string; when_text: string } {
        requirePermission("reminders:write");
        const parsed = parseReminder(text);
        const result = scheduleCoreJob(actor, "reminders.fire", parsed.when, { task: parsed.task });
        if (!result.ok) mapWriteFailure(result.status, result.error);
        return { task: parsed.task, when_text: parsed.when_text };
      },
    },
    timers: {
      // Deterministic duration parsing (reminderParsing.ts), not a
      // language model - see that file's own header for why a timer's
      // precision needs exact arithmetic. Same core-job shape as
      // reminders.set above; firing raises `timer.done` directly.
      set(text: string): { label: string; when_text: string } {
        requirePermission("timers:write");
        const parsed = parseTimerDuration(text);
        const result = scheduleCoreJob(actor, "timers.fire", parsed.when, { label: parsed.label });
        if (!result.ok) mapWriteFailure(result.status, result.error);
        return { label: parsed.label, when_text: parsed.when_text };
      },
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
        deleteAttachmentsForPerson(person);
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
