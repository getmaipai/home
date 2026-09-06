import { init, pause, resume } from "@noriginmedia/norigin-spatial-navigation";

let initialized = false;

/** Called once, the first time the shell ever renders on the TV surface
 * (`useSurface().far`). Real DOM focus is left off (`shouldFocusDOMNode`
 * defaults to false): the nav rail drives its highlight from each item's
 * own `useFocusable().focused` boolean instead of `:focus-visible`, so
 * arrow-key navigation works the same whether or not the browser's own
 * focus ring happens to be visible on a given TV browser. */
export function ensureTvNavInit(): void {
  if (initialized) return;
  initialized = true;
  init({ debug: false, visualDebug: false });
}

// A count, not a plain pause/resume toggle: NotificationBell and
// ProfileSwitcher each call this independently, and a naive boolean broke
// the moment two overlays could ever be open at once (a code review,
// 2026-09-05, caught it before either overlay actually gained a second
// sibling) - closing the second-opened one would have called resume()
// while the first was still open, letting the remote drive the nav rail
// underneath it again.
let openOverlayCount = 0;

/** Radix overlays (Popover, Sheet, Dialog) trap focus and handle their
 * own arrow keys; a household member navigating a menu with the remote
 * should never also drive the nav rail underneath it at the same time
 * (docs/plans/session-b-ui.md step 2). A no-op when the TV surface was
 * never initialized (`ensureTvNavInit()` not yet called), so callers on
 * every other surface can call this unconditionally. */
export function pauseTvNavForOverlay(open: boolean): void {
  if (!initialized) return;
  if (open) {
    openOverlayCount += 1;
    if (openOverlayCount === 1) pause();
  } else {
    openOverlayCount = Math.max(0, openOverlayCount - 1);
    if (openOverlayCount === 0) resume();
  }
}
