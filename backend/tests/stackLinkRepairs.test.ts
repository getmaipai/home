import { describe, expect, test } from "bun:test";
import { StackLinkRepairs, STACK_LINK_OUTAGE_MS, STACK_LINK_RECOVERY_MS, STACK_LINK_REPEAT_WINDOW_MS } from "@/lib/stack/linkRepairs";
import type { LinkRepairDependencies } from "@/lib/stack/linkRepairs";
import type { LinkState } from "@maipai/spec/gen/ts/link-state";

type PendingTimer = { at: number; fn: () => void; cancelled: boolean };
function fixture() {
  let now = 0;
  const timers: PendingTimer[] = [];
  const raises: Array<Record<string, unknown>> = [];
  const resolves: Array<{ source: string; key: string; opts?: Record<string, unknown> }> = [];
  const deps: Partial<LinkRepairDependencies> = {
    now: () => now,
    setTimeout(fn, ms) { const timer = { at: now + ms, fn, cancelled: false }; timers.push(timer); return timer as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout(timer) { const found = timer as unknown as PendingTimer; found.cancelled = true; },
    async raise(input) { raises.push(input as unknown as Record<string, unknown>); },
    resolve(source, key, opts) { resolves.push({ source, key, opts }); },
    readIssue: () => undefined,
  };
  const alerts = new StackLinkRepairs(deps);
  async function tick(ms: number) {
    const end = now + ms;
    while (true) {
      const next = timers.filter((timer) => !timer.cancelled && timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      next.cancelled = true;
      now = next.at;
      next.fn();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  }
  return { alerts, raises, resolves, tick };
}

const down = (reason?: string): LinkState => ({ state: "reconnecting", reason: reason as LinkState["reason"], contract: "1" });
const up: LinkState = { state: "ready", contract: "1", rtt_ms: 5, last_ok_at: new Date(0).toISOString() };

describe("Stack link Repairs alerts", () => {
  test("a short drop raises only a warning and resolves without alerting", async () => {
    const f = fixture();
    f.alerts.stateChanged(down());
    expect(f.raises.map((issue) => issue.severity)).toEqual(["warning"]);
    await f.tick(STACK_LINK_OUTAGE_MS - 1);
    f.alerts.stateChanged(up);
    await f.tick(STACK_LINK_RECOVERY_MS);
    expect(f.raises.some((issue) => issue.severity === "error")).toBe(false);
    expect(f.resolves).toHaveLength(1);
    expect(f.resolves[0]?.opts?.suppressNotification).toBe(true);
  });

  test("two minutes down alerts once, then recovery waits for 60 steady seconds", async () => {
    const f = fixture();
    f.alerts.stateChanged(down());
    await f.tick(STACK_LINK_OUTAGE_MS);
    expect(f.raises.map((issue) => issue.severity)).toEqual(["warning", "error"]);
    expect(f.raises[1]).toMatchObject({ notifyOnEscalation: true, suppressNotification: false });
    f.alerts.stateChanged(up);
    await f.tick(STACK_LINK_RECOVERY_MS - 1);
    expect(f.resolves).toHaveLength(0);
    await f.tick(1);
    expect(f.resolves).toHaveLength(1);
    expect(f.resolves[0]?.opts).toMatchObject({ notificationTitle: "Fixed: the engine computer is back.", suppressNotification: false });
  });

  test("the first failed probe starts the outage clock while the link is degraded", async () => {
    const f = fixture();
    f.alerts.stateChanged({ ...up, state: "degraded", reason: "link_timeout" });
    await f.tick(STACK_LINK_OUTAGE_MS);
    expect(f.raises.map((issue) => issue.severity)).toEqual(["warning", "error"]);
  });

  test("a flap cancels recovery and never creates a second alert for the same outage", async () => {
    const f = fixture();
    f.alerts.stateChanged(down());
    await f.tick(STACK_LINK_OUTAGE_MS);
    f.alerts.stateChanged(up);
    await f.tick(30_000);
    f.alerts.stateChanged(down());
    await f.tick(30_000);
    expect(f.raises.filter((issue) => issue.severity === "error")).toHaveLength(1);
    expect(f.resolves).toHaveLength(0);
    f.alerts.stateChanged(up);
    await f.tick(STACK_LINK_RECOVERY_MS);
    expect(f.resolves).toHaveLength(1);
  });

  test("a reopened outage inside 30 minutes is recorded without another alert", async () => {
    const f = fixture();
    f.alerts.stateChanged(down());
    await f.tick(STACK_LINK_OUTAGE_MS);
    f.alerts.stateChanged(up);
    await f.tick(STACK_LINK_RECOVERY_MS);
    await f.tick(STACK_LINK_REPEAT_WINDOW_MS - STACK_LINK_RECOVERY_MS - 1);
    f.alerts.stateChanged(down());
    await f.tick(STACK_LINK_OUTAGE_MS);
    expect(f.raises.filter((issue) => issue.severity === "error")).toHaveLength(2);
    expect(f.raises.at(-1)).toMatchObject({ suppressNotification: true });
    f.alerts.stateChanged(up);
    await f.tick(STACK_LINK_RECOVERY_MS);
    expect(f.resolves.at(-1)?.opts?.suppressNotification).toBe(true);
  });

  test("host key, update, and away states escalate at once with fixed safe copy", async () => {
    for (const [reason, text] of [
      ["link_host_key_changed", "Pair it again."],
      ["link_needs_update", "maipai-engine update"],
      ["link_outside_home", "Reach it when away from home"],
    ]) {
      const f = fixture();
      f.alerts.stateChanged(down(reason));
      await Promise.resolve();
      const error = f.raises.find((issue) => issue.severity === "error")!;
      const copy = `${String(error.title)} ${String(error.detail)}`;
      expect(copy).toContain(String(text));
      expect(copy).not.toContain("192.0.2.10");
      expect(copy).not.toContain("ssh");
    }
  });
});
