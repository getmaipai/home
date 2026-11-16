import { expect, test } from "bun:test";
import type { Issue } from "@maipai/spec/gen/ts/issue.js";
import { StackLinkRepairs, STACK_LINK_RECOVERY_MS } from "@/lib/stack/linkRepairs";

test("a healthy link resolves an orphaned open issue after the recovery delay", () => {
  let timer: (() => void) | undefined;
  const calls: unknown[] = [];
  const issue = { source: "stack", key: "link.down", resolved_at: null } as Issue;
  const repairs = new StackLinkRepairs({
    readIssue: () => issue,
    setTimeout: (fn, ms) => { expect(ms).toBe(STACK_LINK_RECOVERY_MS); timer = fn; return 1 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: () => {},
    resolve: (...args) => calls.push(args),
  });
  repairs.stateChanged({ state: "ready" } as never);
  expect(calls).toHaveLength(0);
  timer?.();
  expect(calls).toEqual([["stack", "link.down", { suppressNotification: true }]]);
});
