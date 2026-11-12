// HOST-LAUNCH-02 (wired 2026-11-12): the hub tells the development lease broker (scripts/jobs/lease.ts) when a family chat turn is in
// flight, so that in gated mode dev leases wait for it and yield to it. A file, not a call: the hub may be a root service and the broker
// runs as the user, so a small world-readable file in the hub's data directory is the one thing both can reach (local-app/family-active.json,
// path override MAIPAI_FAMILY_ACTIVITY). It says how many turns are running and until when that is true (a refresh every 20 s keeps it
// fresh; a hub that dies mid-turn lets the claim lapse after 60 s). It never queues, caps or delays a turn: every write is advisory and a
// failed write is ignored. The turn itself is unchanged.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "@/lib/paths";

export const familyActivityPath = (): string => process.env.MAIPAI_FAMILY_ACTIVITY ?? join(dataDir, "local-app", "family-active.json");
const CLAIM_SECONDS = 60;
const REFRESH_MS = 20_000;

let active = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function write(): void {
  try {
    const f = familyActivityPath();
    mkdirSync(dirname(f), { recursive: true });
    const tmp = `${f}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ active, until: Math.floor(Date.now() / 1000) + CLAIM_SECONDS }), { mode: 0o644 });
    renameSync(tmp, f);
  } catch { /* advisory: a dev tool reading this must never be able to stop a chat turn */ }
}

/** Counts one family chat turn until the lease's own release (once). Returns the same lease. */
export function trackFamilyTurn<T extends { release(): void }>(lease: T): T {
  active += 1;
  write();
  if (!timer) { timer = setInterval(write, REFRESH_MS); timer.unref?.(); }
  const release = lease.release.bind(lease);
  let counted = true;
  lease.release = () => {
    if (counted) {
      counted = false; active = Math.max(0, active - 1); write();
      if (active === 0 && timer) { clearInterval(timer); timer = null; }
    }
    release();
  };
  return lease;
}

export function __resetFamilyActivityForTests(): void { active = 0; if (timer) { clearInterval(timer); timer = null; } }
