import { afterEach, beforeEach, expect, test } from "bun:test";
import { listIssues } from "@/lib/issues";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import { __resetStackSelfHealForTests, __setNotifierForTests, engineCrashSummary, healNoticeText, pollStackSelfHeal, UNREACHABLE_GAVE_UP_MS, UNREACHABLE_NOTICE_MS } from "@/lib/stackSelfHeal";

const sent: Array<{ type: string; text: string }> = [];
let up = true;
let events: Array<Record<string, unknown>> = [];
const now = Date.parse("2026-10-17T14:50:00.000Z");
beforeEach(() => {
  sent.length = 0; up = true; events = [];
  __resetStackSelfHealForTests();
  __setNotifierForTests(async (type, vars) => { sent.push({ type, text: vars.text ?? "" }); });
  __setStackClientForTests({
    health: async () => { if (!up) throw new StackError("unreachable", "down"); return { health: [] }; },
    selfHeal: async () => ({ enabled: true, crashesByDay: [{ day: "2026-10-17", crashes: 2, healed: 1, gaveUp: 1 }], events, stopped: [], healing: [] }),
  } as never);
});
afterEach(() => { __setNotifierForTests(null); __resetStackEngineForTests(); __resetStackSelfHealForTests(); });

const healed = (id: string, role = "chat") => ({ id, kind: "healed", at: "2026-10-17T14:48:12.000Z", role, cause: "x", causeKind: "killed", seconds: 12, crashedAt: "2026-10-17T14:48:00.000Z" });

test("a restart the Stack did becomes one admin notification, once per incident", () => {
  expect(healNoticeText(healed("a") as never)).toMatch(/^Chat engine crashed and was restarted at \d\d:\d\d; it was back in 12 seconds\.$/);
});

test("the same incident is not announced twice, and a flapping engine is one notice per 10 minutes", async () => {
  events = [healed("chat:1:healed"), { ...healed("chat:2:healed"), crashedAt: "2026-10-17T14:49:00.000Z" }, healed("embed:1:healed", "embed")];
  await pollStackSelfHeal(now);
  await pollStackSelfHeal(now + 30_000);
  expect(sent.filter((n) => n.type === "stack.engine_healed")).toHaveLength(2);
});

test("old news is not replayed", async () => {
  events = [{ ...healed("old"), at: "2026-10-16T01:00:00.000Z" }];
  await pollStackSelfHeal(now);
  expect(sent).toHaveLength(0);
});

test("Stack unreachable: nothing at 1 minute, 'restarting itself' at 2, 'could not restart itself: open Repairs' at 6, resolved when it answers", async () => {
  up = false;
  await pollStackSelfHeal(now);
  await pollStackSelfHeal(now + 60_000);
  expect(sent).toHaveLength(0);
  await pollStackSelfHeal(now + UNREACHABLE_NOTICE_MS);
  await pollStackSelfHeal(now + UNREACHABLE_NOTICE_MS + 30_000);
  expect(sent).toEqual([{ type: "stack.restarting", text: "The AI stopped and is restarting itself." }]);
  expect(listIssues().find((i) => i.key === "unreachable")).toMatchObject({ severity: "warning", title: "The AI stopped and is restarting itself" });
  await pollStackSelfHeal(now + UNREACHABLE_GAVE_UP_MS);
  expect(listIssues().find((i) => i.key === "unreachable")).toMatchObject({ severity: "error", title: "The AI could not restart itself: open Repairs" });
  up = true;
  await pollStackSelfHeal(now + UNREACHABLE_GAVE_UP_MS + 30_000);
  expect(listIssues().find((i) => i.key === "unreachable")).toBeUndefined();
});

test("the Status page line counts today's crashes", async () => {
  await pollStackSelfHeal(now);
  expect(engineCrashSummary(new Date(now))).toMatchObject({ count: 2, healed: 1, gave_up: 1, line: "Engines crashed 2 times today; the Stack restarted 1 of them and gave up on 1." });
  expect(engineCrashSummary(new Date("2026-10-18T10:00:00Z")).line).toBe("No engine has crashed today.");
});
