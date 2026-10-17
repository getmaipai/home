import "./providers";
import { purgeExpired } from "./registry";

export const TRASH_SWEEP_MS = 6 * 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | undefined;
export function startTrashSweeper(): void {
  if (timer) return;
  purgeExpired();
  timer = setInterval(() => purgeExpired(), TRASH_SWEEP_MS);
  timer.unref();
}
export function stopTrashSweeper(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
