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
// - A new service worker takes control mid-session, on a page a worker
//   was already controlling (workbox's own `controllerchange` event):
//   reload once so the tab is running the code that matches what just got
//   cached. A page's very first load, with no prior controller, is
//   deliberately excluded - it already has the right content straight
//   from the network, nothing stale to reload for.
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
  win.addEventListener("vite:preloadError", () => {
    if (getRetryCount(storage, RETRY_KEY) >= MAX_BOOT_RETRIES) return;
    bumpRetryCount(storage, RETRY_KEY);
    win.location.reload();
  });
}

/** The classic workbox "reload on controllerchange" pattern, guarded so a
 * spurious second event in the same page life (there shouldn't be one, but
 * nothing about the browser contract promises there won't be) can't loop.
 *
 * Only wired up when a service worker was ALREADY controlling this page
 * before this call - a real code-review finding (2026-09-06), confirmed
 * live by `scripts/screenshot.ts`'s own axe scan throwing "Execution
 * context was destroyed" on a brand-new browser context's very first
 * page: that page has no prior controller, so its first-ever activation
 * fired `controllerchange` and forced an unconditional reload the doc
 * comment above never actually meant to cover ("a new service worker
 * takes control MID-SESSION" - a page that already has one). A page's
 * first-ever load already has the right content straight from the
 * network; it was never served through the cache this SW is just now
 * starting to build, so there is nothing stale to reload for. */
export function installReloadOnceOnNewServiceWorker(container: ServiceWorkerContainer, win: Window): void {
  if (!container.controller) return;
  let reloaded = false;
  container.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    win.location.reload();
  });
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
