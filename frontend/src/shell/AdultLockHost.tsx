// ADULT-LOCK-03b and -05: the shell's host for the kit's `AdultLockProvider` (docs/design/video-loras-2026-11-02.md sections 3.3 to 3.4 and 3.9,
// docs/dev/adult-lock.md "Frontend"). The kit draws the lock tile, the dialog and the live region; this file is only what the host owes it:
// the real `/api/adult-lock/unlock` call, the proof held in memory (lib/adultLock.ts), the relock clocks, the playback guards, and a refetch of
// every page list when the lock changes. Nothing here draws a lock tile or a dialog of its own (RULES 9b).
import { useCallback, useEffect, useMemo, useRef, type ComponentProps } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { getIcon } from "@maipai/ui/src/icons";
import { AdultLockProvider, useLockProof, type UnlockResult } from "@maipai/ui/src/elements/adult-lock";
import { Button } from "@maipai/ui/src/ui/button";
import { ADULT_PROOF_HEADER, adultClocks, forgetOpenIds, installAdultFetch, getAdultProof, onAdultFlip, revokeAdultBlobs, setAdultProof, unloadAdultElements } from "@/lib/adultLock";
import { installAdultPlaybackGuard } from "@/shell/adultPlaybackGuard";
import { useMediaDock } from "@/shell/mediaHost";
import type { Roster } from "@/lib/api";

/** The check of the person's own passcode, against the hub's route. Maps the route's answers to the kit's three results; anything else rejects ("could not check"). */
export async function unlockRequest(secret: string, visit: string, fetcher: typeof fetch = fetch): Promise<UnlockResult> {
  const res = await fetcher("/api/adult-lock/unlock", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, visit }) });
  const body = await res.json().catch(() => ({})) as { proof?: unknown; attemptsLeft?: unknown; retryAfter?: unknown };
  if (res.ok && typeof body.proof === "string") return { status: "ok", proof: body.proof };
  if (res.status === 429) return { status: "locked_out", retryAfterSeconds: typeof body.retryAfter === "number" ? body.retryAfter : 60 };
  if (res.status === 401) return { status: "failed", ...(typeof body.attemptsLeft === "number" ? { attemptsLeft: body.attemptsLeft } : {}) };
  throw new Error("unlock failed");
}

/** Tells the hub this page's proof no longer counts. Always sent with the proof being dropped. */
export function sendLock(proof: string): void {
  void fetch("/api/adult-lock/lock", { method: "POST", credentials: "include", headers: { [ADULT_PROOF_HEADER]: proof } }).catch(() => undefined);
}

const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** The relock clocks and the media teardown, inside the provider so it can read the proof and call `relock()`. */
export function AdultLockController() {
  const { unlocked, relock } = useLockProof();
  const dock = useMediaDock();
  const dockRef = useRef(dock);
  dockRef.current = dock;
  const relockRef = useRef(relock);
  relockRef.current = relock;
  const { pathname } = useLocation();
  const seenPath = useRef(pathname);

  // A page is a route: leaving it relocks (the settings areas and the chat pages are routes too).
  useEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    relockRef.current();
  }, [pathname]);

  // Everything below runs only while unlocked.
  useEffect(() => {
    if (!unlocked) return;
    const lockNow = () => relockRef.current();
    const onVisibility = () => { if (document.visibilityState === "hidden") lockNow(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", lockNow);
    let idle = window.setTimeout(lockNow, adultClocks.idleMs);
    const touch = () => { window.clearTimeout(idle); idle = window.setTimeout(lockNow, adultClocks.idleMs); };
    for (const name of ACTIVITY) window.addEventListener(name, touch, { passive: true });
    // A playing clip counts as activity (design 3.3 item 5): its time updates keep the idle clock open.
    document.addEventListener("timeupdate", touch, true);
    const cap = window.setTimeout(lockNow, adultClocks.capMs);
    // A flag that flips on while something plays stops it and relocks at once.
    const stopFlip = onAdultFlip(() => {
      const playing = Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio")).some((el) => !el.paused && !el.ended) || dockRef.current.current !== null;
      if (!playing) return;
      dockRef.current.clear();
      lockNow();
    });
    const stopGuard = installAdultPlaybackGuard();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", lockNow);
      for (const name of ACTIVITY) window.removeEventListener(name, touch);
      document.removeEventListener("timeupdate", touch, true);
      window.clearTimeout(idle);
      window.clearTimeout(cap);
      stopFlip();
      stopGuard();
    };
  }, [unlocked]);

  const LockIcon = getIcon("lock");
  return unlocked ? (
    <div className="fixed bottom-4 left-4 z-40">
      <Button type="button" variant="secondary" size="sm" onClick={() => relock()}>
        <LockIcon aria-hidden />
        Lock now
      </Button>
    </div>
  ) : null;
}

/** The props the kit's `AdultLockProvider` takes, for the shell to render the Element itself (RULES 9: no Home component wraps a kit Element). Installs the
 * fetch choke point for the page before the first child renders and puts it back when the shell goes. */
export function useAdultLockProps(person: Pick<Roster, "pinDigits" | "hasSecret">): Omit<ComponentProps<typeof AdultLockProvider>, "children"> {
  const queryClient = useQueryClient();
  const restoreFetch = useRef<(() => void) | null>(null);
  if (restoreFetch.current === null) restoreFetch.current = installAdultFetch();
  useEffect(() => {
    restoreFetch.current ??= installAdultFetch(); // a development double mount puts it back
    return () => { restoreFetch.current?.(); restoreFetch.current = null; };
  }, []);
  const visit = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)), []);
  const digits = person.pinDigits && person.pinDigits >= 1 ? person.pinDigits : null;
  const unlock = useCallback((secret: string) => unlockRequest(secret, visit), [visit]);
  const onUnlocked = useCallback((proof: string | null) => {
    setAdultProof(proof);
    forgetOpenIds();
    // Every list that may hold a locked item asks again, now with the proof.
    void queryClient.resetQueries();
  }, [queryClient]);
  const onRelock = useCallback(() => {
    const used = getAdultProof();
    if (used) sendLock(used);
    setAdultProof(null);
    unloadAdultElements();
    revokeAdultBlobs();
    forgetOpenIds();
    // Nothing unlocked may stay in the cache: reset, so a locked list shows the tile again.
    void queryClient.resetQueries();
  }, [queryClient]);
  // The kit's dialog takes the digits of a passcode; without a digit passcode it says where to set one (design 3.2).
  const hasCredential = person.hasSecret !== false && digits !== null;
  return { unlock, digits: digits ?? 6, credentialWord: "passcode", hasCredential, onUnlocked, onRelock };
}
