// ADULT-LOCK-03b and -05: the page's side of the Adult lock (docs/dev/adult-lock.md, "Frontend"). The unlock proof the hub issues lives in ONE
// module variable here: never localStorage, sessionStorage, a cookie, a URL or the query cache's persisted copy. `request()` reads it for the
// `X-Adult-Unlock` header; an unlocked adult-only item's pictures and clip are fetched with that header into a Blob and shown from an object
// URL (a header cannot ride on a `<video src>`), and every object URL made here is revoked when the page relocks.
export const ADULT_PROOF_HEADER = "X-Adult-Unlock";
/** Same numbers as the hub's `PROOF_IDLE_MS` and `PROOF_ABSOLUTE_MS` (backend/src/lib/adultLock.ts); the page drops its copy on the same clocks. */
export const ADULT_IDLE_MS = 2 * 60 * 1000;
export const ADULT_CAP_MS = 15 * 60 * 1000;
/** The clocks the page runs; tests shorten them, nothing else writes here. */
export const adultClocks = { idleMs: ADULT_IDLE_MS, capMs: ADULT_CAP_MS };

let proof: string | null = null;

export function getAdultProof(): string | null { return proof; }
export function setAdultProof(value: string | null): void { proof = value; }
/** The header object for a request: empty while locked. */
export function adultHeaders(): Record<string, string> { return proof ? { [ADULT_PROOF_HEADER]: proof } : {}; }

// ---- Blob sources -------------------------------------------------------------------------------------------------------------------------

/** Row keys a package page reads a picture or clip from; only an adult-only row's values are fetched into blobs. */
export const ADULT_MEDIA_KEYS = ["src", "still", "poster", "thumbnail", "thumb_url", "backdrop", "loop"] as const;

const blobs = new Map<string, Promise<string | null>>();
const made = new Set<string>();

export function isAdultBlobUrl(url: string | null | undefined): boolean { return !!url && made.has(url); }

/** Fetch `path` with the proof header into an object URL; null when the hub refuses (a locked or missing item answers 404). Cached per path until relock. */
export function adultBlobUrl(path: string): Promise<string | null> {
  const known = blobs.get(path);
  if (known) return known;
  const used = proof;
  const pending = (async () => {
    try {
      const res = await fetch(path, { credentials: "include", headers: used ? { [ADULT_PROOF_HEADER]: used } : {}, cache: "no-store" });
      if (!res.ok) return null;
      if (proof !== used) return null; // relocked while it loaded
      const url = URL.createObjectURL(await res.blob());
      if (proof !== used) { URL.revokeObjectURL(url); return null; }
      made.add(url);
      return url;
    } catch { return null; }
  })();
  blobs.set(path, pending);
  void pending.then((url) => { if (url === null && blobs.get(path) === pending) blobs.delete(path); });
  return pending;
}

/** Revoke every object URL made for an unlocked item (relock, route change, tab hidden, idle, sign-out, unmount). */
export function revokeAdultBlobs(): void {
  for (const url of made) URL.revokeObjectURL(url);
  made.clear();
  blobs.clear();
}

/** Stop and unload every element that holds one of our object URLs (pause, drop `src`, `load()`), so nothing keeps playing from a revoked URL. */
export function unloadAdultElements(root: ParentNode = document): number {
  const found = new Set<HTMLMediaElement>(tracked);
  root.querySelectorAll<HTMLMediaElement>("video,audio").forEach((el) => {
    if (isAdultBlobUrl(el.getAttribute("src")) || isAdultBlobUrl(el.currentSrc)) found.add(el);
  });
  tracked.clear();
  for (const el of found) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  // A picture drawn from one of our URLs goes too, so nothing decoded stays on screen if the lists are slow to ask again.
  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => { if (isAdultBlobUrl(img.getAttribute("src"))) img.removeAttribute("src"); });
  return found.size;
}

// An element the page already removed (a route change unmounts the player before the relock runs) is still unloaded: the guard hands each one it saw to here.
const tracked = new Set<HTMLMediaElement>();
export function trackAdultElement(el: HTMLMediaElement): void { tracked.add(el); }

// ---- Rows ---------------------------------------------------------------------------------------------------------------------------------

const OPEN_IDS_CAP = 2000;
const openIds = new Set<string>();
const flipListeners = new Set<(id: string) => void>();
/** The page asks to hear about an item that was open and is now adult-only (a flag that flips on while someone may be watching it). */
export function onAdultFlip(listener: (id: string) => void): () => void {
  flipListeners.add(listener);
  return () => flipListeners.delete(listener);
}
export function forgetOpenIds(): void { openIds.clear(); }

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

function visit(value: unknown, depth: number, jobs: Array<Promise<void>>, flipped: string[]): void {
  if (depth > 4) return;
  if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1, jobs, flipped); return; }
  if (!isRow(value)) return;
  const id = typeof value.id === "string" ? value.id : null;
  if (value.adult_only === true) {
    if (id && openIds.has(id)) { flipped.push(id); openIds.delete(id); }
    if (proof) {
      for (const key of ADULT_MEDIA_KEYS) {
        const raw = value[key];
        if (typeof raw !== "string" || !raw.startsWith("/api/")) continue;
        jobs.push(adultBlobUrl(raw).then((url) => { if (url) value[key] = url; else value[key] = null; }));
      }
    }
    return;
  }
  if (id && value.locked !== true) { if (openIds.size >= OPEN_IDS_CAP) openIds.clear(); openIds.add(id); }
  for (const key of Object.keys(value)) { const inner = value[key]; if (typeof inner === "object" && inner !== null) visit(inner, depth + 1, jobs, flipped); }
}

/** Run on a page-data response: an adult-only row's picture and clip become blob URLs (only while unlocked: without a proof the hub sends the tile),
 * and an item that was an open row and is now adult-only is reported to `onAdultFlip` listeners. Returns the same body, edited in place. */
export async function adultResponse<T>(body: T): Promise<T> {
  await adultRows(body);
  return body;
}

/** The row pass; true when it rewrote a source (the caller then sends the edited body on). */
export async function adultRows(body: unknown): Promise<boolean> {
  if (typeof body !== "object" || body === null) return false;
  const jobs: Array<Promise<void>> = [];
  const flipped: string[] = [];
  visit(body, 0, jobs, flipped);
  if (jobs.length) await Promise.all(jobs);
  for (const id of flipped) flipListeners.forEach((listener) => listener(id));
  return jobs.length > 0;
}

// ---- The one fetch choke point -----------------------------------------------------------------------------------------------------------

const isPageDataPath = (path: string): boolean => path.startsWith("/api/plugins/") || path.startsWith("/api/media/");

function sameOriginApiPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith("/api/")) return raw;
  try {
    const url = new URL(raw, typeof location === "undefined" ? "http://localhost" : location.href);
    if (typeof location !== "undefined" && url.origin === location.origin && url.pathname.startsWith("/api/")) return url.pathname + url.search;
  } catch { /* not a URL */ }
  return null;
}

/** Wrap `fetch` once for the page: while unlocked every same-origin `/api/` request carries `X-Adult-Unlock`, and a page-data answer goes through the
 * row pass (`adultResponse`). The kit's schema interpreter has its own request function (it cannot import Home's), so the one place both Home's `request`
 * and the kit's reach the network is `fetch` itself. Returns the function that puts the original back. */
let installs = 0;
let restoreReal: (() => void) | null = null;

export function installAdultFetch(): () => void {
  installs += 1;
  if (installs === 1) restoreReal = wrapFetch();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    installs -= 1;
    if (installs === 0) { restoreReal?.(); restoreReal = null; }
  };
}

function wrapFetch(): () => void {
  const real = globalThis.fetch;
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = sameOriginApiPath(input);
    if (path === null) return real(input, init);
    let nextInit = init;
    let nextInput = input;
    if (proof) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has(ADULT_PROOF_HEADER)) headers.set(ADULT_PROOF_HEADER, proof);
      if (init || !(input instanceof Request)) nextInit = { ...init, headers };
      else nextInput = new Request(input, { headers });
    }
    const res = await real(nextInput, nextInit);
    if (!isPageDataPath(path.split("?")[0]!) || !res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return res;
    const body = await res.clone().json().catch(() => undefined) as unknown;
    if (body === undefined || !(await adultRows(body))) return res;
    // The body is longer than the one the hub sent: its length and encoding headers no longer describe it.
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers });
  }) as typeof fetch;
  globalThis.fetch = wrapped;
  return () => { if (globalThis.fetch === wrapped) globalThis.fetch = real; };
}

/** The kind of secret the person signs in with, for the kit's adult-lock dialog (ADULT-LOCK-07): a digit PIN draws the digit boxes, anything else
 * (a password) draws the masked password field. The roster already carries `pinDigits` (null for a password), so no new field is needed. */
export function adultCredential(person: { pinDigits?: number | null } | null | undefined): { credentialKind: "passcode" | "password"; credentialWord: "passcode" | "password"; digits: number } {
  const digits = person?.pinDigits && person.pinDigits >= 1 ? person.pinDigits : null;
  return digits ? { credentialKind: "passcode", credentialWord: "passcode", digits } : { credentialKind: "password", credentialWord: "password", digits: 6 };
}
