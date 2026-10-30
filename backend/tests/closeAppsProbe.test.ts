import { describe, expect, test } from "bun:test";
import { HARMLESS_TEST_APP, probeCloseApps } from "@/lib/closeAppsProbe";

type Reply = Record<string, unknown> | null;
function fakeHelper(script: { list: Reply[]; quit?: Reply }) {
  const sent: Record<string, unknown>[] = [];
  const lists = [...script.list];
  const ask = async (request: Record<string, unknown>): Promise<Reply> => {
    sent.push(request);
    if (request.op === "list") return lists.length > 1 ? lists.shift()! : lists[0]!;
    if (request.op === "reopen") return { ok: true, reopened: true };
    return script.quit ?? { ok: true, outcome: "quit" };
  };
  return { ask, sent };
}
const withTest = { ok: true, apps: [{ bundleId: HARMLESS_TEST_APP, name: "Calculator" }] };
const without = { ok: true, apps: [] };

describe("probeCloseApps", () => {
  test("no answer from the helper reads as no_helper and nothing else is sent", async () => {
    const { ask, sent } = fakeHelper({ list: [null] });
    expect(await probeCloseApps(ask, 0)).toBe("no_helper");
    expect(sent.map((r) => r.op)).toEqual(["list"]);
  });
  test("opens the harmless app, then quits it, and reports ok", async () => {
    const { ask, sent } = fakeHelper({ list: [without, withTest] });
    expect(await probeCloseApps(ask, 0)).toBe("ok");
    expect(sent.map((r) => r.op)).toEqual(["list", "reopen", "list", "quit"]);
    expect(sent.every((r) => r.op === "list" || r.bundleId === HARMLESS_TEST_APP)).toBe(true);
  });
  test("an app that stays open after the quit request means not allowed", async () => {
    const { ask } = fakeHelper({ list: [withTest], quit: { ok: true, outcome: "still_running" } });
    expect(await probeCloseApps(ask, 0)).toBe("not_allowed");
  });
  test("a test app that never opens means not allowed", async () => {
    const { ask } = fakeHelper({ list: [without] });
    expect(await probeCloseApps(ask, 0)).toBe("not_allowed");
  });
});
