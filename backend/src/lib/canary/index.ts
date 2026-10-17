import { canaryTick } from "./runner";
import { realDeps } from "./probes";

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the one 60 second synthetic-work tick. The first tick runs the full suite (post-start). */
export function startCanary(): void {
  if (timer || process.env.MAIPAI_CANARY === "off" || process.env.NODE_ENV === "test") return;
  const tick = () => { canaryTick(realDeps).catch((error: Error) => console.error(`[canary] tick failed: ${error.message}`)); };
  setTimeout(tick, 20_000).unref();
  timer = setInterval(tick, 60_000);
  timer.unref();
}
