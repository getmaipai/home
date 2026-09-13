// #73: the hub's one shutdown path. Stopping the hub used to leave its
// engines running as orphans (SIGTERM handled the Wyoming server only;
// a fatal error exited with nothing stopped), and a stopped hub whose
// 8B, embed and judge engines lived on was the shape found twice on
// 2026-09-13. Called from SIGINT/SIGTERM (index.ts) and from the fatal
// handlers (lib/log.ts): each supervisor's own stop, in order, each
// awaited (watchEngine()'s stop sends SIGTERM and escalates to SIGKILL
// after five seconds), and a deadline on the whole so a stop that never
// resolves cannot keep a dying process alive. Idempotent: a second
// signal during the shutdown joins the first. A stop that throws is
// logged and the next one still runs; the promise never rejects, since
// the fatal handler that awaits it would otherwise raise a second
// unhandled rejection into the same handler.
import { stopChatBackend } from "@/lib/llmSupervisor";
import { restartEmbedBackend } from "@/lib/embedSupervisor";
import { restartBackgroundBackend } from "@/lib/backgroundSupervisor";

export const SHUTDOWN_DEADLINE_MS = 20_000;

let shutdownPromise: Promise<void> | null = null;

export async function shutdownEngines(
  stops: Array<() => void | Promise<void>> = [stopChatBackend, restartEmbedBackend, restartBackgroundBackend],
  deadlineMs = SHUTDOWN_DEADLINE_MS,
): Promise<void> {
  shutdownPromise ??= (async () => {
    const all = (async () => {
      for (const stop of stops) {
        try {
          await stop();
        } catch (err) {
          console.error(`[shutdown] an engine stop failed: ${(err as Error).message}`);
        }
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.error(`[shutdown] engines did not all stop within ${deadlineMs} ms; exiting anyway`);
        resolve();
      }, deadlineMs);
    });
    await Promise.race([all, deadline]);
    clearTimeout(timer);
  })();
  await shutdownPromise;
}

export function __resetHubShutdownForTests(): void {
  shutdownPromise = null;
}
