// docs/UI.md > Responsive layout, PWA, tabs, icons: "an app-shell service
// worker... an offline page... iOS quirks... handled once." This is the
// "handled once" part: the shell's own boot resilience, so no package ever
// has to think about a stale cached chunk or a broken boot.
//
// Three independent failure modes, three guards sharing one reload budget
// (`RETRY_KEY`, capped at `MAX_BOOT_RETRIES`): each one reloads for the
// same underlying reason (something about this load is broken, try once
// more), so a single permanently broken deploy can only ever cost three
// reload cycles total, never three per guard.
// - A deploy lands while a tab has the old shell cached: the next lazy
//   `import()` 404s. Vite's own runtime fires `vite:preloadError` for
//   exactly this (https://vite.dev/guide/build.html#load-error-handling);
//   reload to pick up the new shell.
// - A new service worker taking control (after a hub restart ships a new
//   build) never reloads a page the person is looking at. It used to
//   reload at once (workbox's classic "reload on controllerchange"), which
//   made the first load after every restart load twice (owner's report,
//   2026-10-06, measured by `scripts/screenshot.ts --shell-nav-review`).
//   A page that just loaded already has the new build's HTML (navigations
//   are network-first in sw.ts). A tab that stayed open across the restart
//   still runs the old bundle, so it reloads once, the next time it is
//   hidden (the person switched away), where nobody sees it.
// - The shell itself fails to boot (a corrupt cached asset, a synchronous
//   render throw): retry via reload, up to the shared cap, so a
//   permanently broken deploy shows a real error instead of reloading
//   forever.

// One shared counter, not one per guard: a code-review finding
// (2026-09-06) caught the original two-key version letting a single
// permanently broken deploy exhaust the stale-chunk cap (3 reloads) and
// then, independently, the boot-watchdog cap (3 more) - up to six total
// reload cycles, contradicting this file's own "capped at three attempts"
// promise above. All three guards below reload for the same underlying
// reason (something about this load is broken, try once more), so they
// share one budget.
const RETRY_KEY = "maipai:reload-retry-count";
export const MAX_BOOT_RETRIES = 3;
export const BOOT_WATCHDOG_MS = 8000;

export function getRetryCount(storage: Storage, key: string): number {
  const raw = storage.getItem(key);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function bumpRetryCount(storage: Storage, key: string): number {
  const next = getRetryCount(storage, key) + 1;
  storage.setItem(key, String(next));
  return next;
}

function clearRetryCount(storage: Storage, key: string): void {
  storage.removeItem(key);
}

/** Vite's own stale-chunk signal. Capped the same way the boot watchdog is:
 * a deploy that somehow keeps breaking every chunk must not reload forever.
 * The count is cleared only by a confirmed successful boot
 * (`runBootWatchdog`'s `confirmBooted`), never just by this function
 * running again - it runs again on every reload, including the ones this
 * exact cap exists to eventually stop. */
export function installStaleChunkRetry(win: Window, storage: Storage): void {
  win.addEventListener("vite:preloadError", (event) => {
    if (getRetryCount(storage, RETRY_KEY) >= MAX_BOOT_RETRIES) return;
    // Vite's own dispatcher (`handlePreloadError`) re-throws the
    // original rejection whenever nothing calls `preventDefault()` on
    // this cancelable event - found live (lane 10 item 2's own review,
    // 2026-09-13) reading Vite's source: without this, the failed
    // `import()` still propagates to whichever Suspense boundary/
    // ErrorBoundary is above it, a real crash-UI flash on the way to a
    // reload this listener already has in flight regardless.
    event.preventDefault();
    bumpRetryCount(storage, RETRY_KEY);
    win.location.reload();
  });
}

/** A new worker took control (a hub restart shipped a new build): reload
 * once, but only while the page is hidden, so the person never sees it.
 * Only wired when a worker was already controlling this page at boot: a
 * first-ever load has nothing stale (the original code review's finding,
 * 2026-09-06). Not part of the shared budget: it reloads at most once per
 * page life and only for a real update. */
export function installHiddenReloadOnNewServiceWorker(container: ServiceWorkerContainer, doc: Document, win: Window): void {
  if (!container.controller) return;
  let pending = false;
  let reloaded = false;
  const reloadIfHidden = () => {
    if (!pending || reloaded || doc.visibilityState !== "hidden") return;
    reloaded = true;
    win.location.reload();
  };
  container.addEventListener("controllerchange", () => {
    pending = true;
    reloadIfHidden();
  });
  doc.addEventListener("visibilitychange", reloadIfHidden);
}

/** Runs `boot`, which must call `confirmBooted()` once the app is actually
 * alive (mounted and past its first render, not just past the synchronous
 * `render()` call - a hang during a lazy import happens after that call
 * returns). A synchronous throw from `boot` itself counts as an immediate
 * failure. Either way, a failure retries via reload up to `MAX_BOOT_RETRIES`
 * times; past that, `onGiveUp` runs instead of yet another reload. */
export function runBootWatchdog(
  win: Window,
  storage: Storage,
  boot: (confirmBooted: () => void) => void,
  onGiveUp: () => void,
): void {
  if (getRetryCount(storage, RETRY_KEY) >= MAX_BOOT_RETRIES) {
    clearRetryCount(storage, RETRY_KEY);
    onGiveUp();
    return;
  }

  let settled = false;
  const fail = (cause?: unknown) => {
    if (settled) return;
    settled = true;
    // A code review (2026-09-06) found this catching a synchronous boot
    // throw (a missing #root, or any other render error) with no trace at
    // all: the page would just silently reload up to MAX_BOOT_RETRIES
    // times and then land on renderBootFailure's generic message, with
    // nothing in the console to say why boot actually failed.
    if (cause !== undefined) console.error("MaiPai Home failed to boot", cause);
    bumpRetryCount(storage, RETRY_KEY);
    win.location.reload();
  };
  const timer = win.setTimeout(() => fail(), BOOT_WATCHDOG_MS);
  const confirmBooted = () => {
    if (settled) return;
    settled = true;
    win.clearTimeout(timer);
    clearRetryCount(storage, RETRY_KEY);
  };

  try {
    boot(confirmBooted);
  } catch (err) {
    win.clearTimeout(timer);
    fail(err);
  }
}
