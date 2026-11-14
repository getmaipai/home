import { randomBytes } from "node:crypto";
import { issueDeviceCommand } from "@/lib/deviceCommands";
import type { IdentifyOutcome } from "@/lib/music/identify";

export type ListenOutcome = IdentifyOutcome | { status: "timeout" };
type Waiter = { deviceId: string; timer: ReturnType<typeof setTimeout>; resolve: (outcome: ListenOutcome) => void };
const waiters = new Map<string, Waiter>();
let commandIssuer = issueDeviceCommand;

export function requestListen(deviceId: string, options: { seconds?: number; timeoutMs?: number } = {}): Promise<ListenOutcome> {
  const requestId = randomBytes(6).toString("hex");
  const timeoutMs = options.timeoutMs ?? 22_000;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(requestId);
      resolve({ status: "timeout" });
    }, timeoutMs);
    waiters.set(requestId, { deviceId, timer, resolve });
    try {
      commandIssuer(deviceId, "listen_song", { request_id: requestId, ...(options.seconds ? { seconds: options.seconds } : {}) }, 60_000);
    } catch {
      clearTimeout(timer);
      waiters.delete(requestId);
      resolve({ status: "failed", reason: "unexpected" });
    }
  });
}

export function resolveListen(deviceId: string, requestId: string, outcome: IdentifyOutcome): void {
  const waiter = waiters.get(requestId);
  if (!waiter || waiter.deviceId !== deviceId) return;
  clearTimeout(waiter.timer);
  waiters.delete(requestId);
  waiter.resolve(outcome);
}

export function __resetListenRequestsForTests(): void {
  for (const [id, waiter] of waiters) { clearTimeout(waiter.timer); waiters.delete(id); waiter.resolve({ status: "timeout" }); }
}
export function __setListenCommandIssuerForTests(issuer: typeof issueDeviceCommand | null): void { commandIssuer = issuer ?? issueDeviceCommand; }
