// Home no longer owns model processes. This shared shutdown hook remains
// for injected cleanup work and is currently called with no engine stops.
// It stays bounded and idempotent for callers that supply their own work.

export const SHUTDOWN_DEADLINE_MS = 20_000;

let shutdownPromise: Promise<void> | null = null;
export async function shutdownEngines(
  stops: Array<() => void | Promise<void>> = [],
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
