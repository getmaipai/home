import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "./reset-db";
import { raiseIssue, registerFixHandler, __resetFixHandlersForTests } from "@/lib/issues";
import { owner, teen } from "./support/testAuth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture, type StackFixture } from "./stackFixture";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
});

describe("GET /api/repairs", () => {
  test("requires owner/admin, not just any signed-in person", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const res = await teenClient.get("/api/repairs");
    expect(res.status).toBe(403);
  });

  test("lists only unresolved issues by default", async () => {
    const { client } = await owner();
    await raiseIssue({ source: "a", key: "1", severity: "warning", title: "Open one", detail: "d" });
    const res = await client.get("/api/repairs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });
});

describe("POST /api/repairs/:id/fix", () => {
  test("runs the registered fix and resolves the issue", async () => {
    const { client } = await owner();
    let ran = false;
    registerFixHandler("do_it", () => {
      ran = true;
    });
    const issue = await raiseIssue({
      source: "a",
      key: "1",
      severity: "error",
      title: "T",
      detail: "d",
      fix: { label: "Fix it", action: "do_it" },
    });
    const res = await client.post(`/api/repairs/${issue.id}/fix`);
    expect(res.status).toBe(200);
    expect(ran).toBe(true);

    const list = (await (await client.get("/api/repairs")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  test("404s for an unknown issue", async () => {
    const { client } = await owner();
    const res = await client.post("/api/repairs/issue-nope/fix");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/repairs/:id/dismiss", () => {
  test("resolves the issue", async () => {
    const { client } = await owner();
    const issue = await raiseIssue({ source: "a", key: "1", severity: "info", title: "T", detail: "d" });
    const res = await client.post(`/api/repairs/${issue.id}/dismiss`);
    expect(res.status).toBe(200);
    const list = (await (await client.get("/api/repairs")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });
});

// HOME-STACK-05: "the Repairs list shows the Stack's health items as
// data with their one fix button through healthFix(code)" - synced
// live into this same table on every GET, so no new frontend surface
// is needed to display them.
describe("GET /api/repairs, with a configured Stack", () => {
  let fixture: StackFixture;

  afterEach(() => {
    fixture?.stop();
    __resetStackEngineForTests();
  });

  test("a scripted health item renders as a real Issue with its fix calling healthFix(code)", async () => {
    let fixCalls: string[] = [];
    let fixed = false;
    fixture = startStackFixture({
      "GET /stack/v1/health": async () =>
        Response.json({
          // A real Stack stops reporting the item once its own fix
          // actually resolves the underlying problem - simulated here
          // so this test can tell "the fix ran" apart from "the fix ran
          // AND the Stack confirms it worked," the same distinction the
          // next test below covers on its own.
          health: fixed
            ? []
            : [
                {
                  code: "engine.crashed.chat",
                  severity: "critical",
                  title: "The chat engine crashed",
                  text: "The chat engine process stopped.",
                  since: "2026-09-20T00:00:00Z",
                  cause: "the process exited",
                  fix: { label: "Restart the chat engine", action: "restart_engine" },
                },
              ],
        }),
      "POST /stack/v1/health/engine.crashed.chat/fix": async () => {
        fixCalls.push("engine.crashed.chat");
        fixed = true;
        return Response.json({ ok: true, result: "restarted" });
      },
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const { client } = await owner();
    const list = (await (await client.get("/api/repairs")).json()) as Array<{ id: string; source: string; severity: string; title: string; fix: { label: string } | null }>;
    const item = list.find((i) => i.source === "stack" && i.title === "The chat engine crashed");
    expect(item).toBeDefined();
    // critical has no tier of its own on Issue's severity enum - mapped
    // to Home's most severe, "error".
    expect(item!.severity).toBe("error");
    expect(item!.fix?.label).toBe("Restart the chat engine");

    const fixRes = await client.post(`/api/repairs/${item!.id}/fix`);
    expect(fixRes.status).toBe(200);
    expect(fixCalls).toEqual(["engine.crashed.chat"]);

    const after = (await (await client.get("/api/repairs")).json()) as unknown[];
    expect(after.some((i) => (i as { id: string }).id === item!.id)).toBe(false);
  });

  test("an item the Stack stops reporting is resolved on the next read", async () => {
    let reportItem = true;
    fixture = startStackFixture({
      "GET /stack/v1/health": async () =>
        Response.json({
          health: reportItem
            ? [{ code: "engine.crashed.chat", severity: "warning", title: "The chat engine crashed", text: "t", since: "2026-09-20T00:00:00Z", cause: "c" }]
            : [],
        }),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const { client } = await owner();
    const first = (await (await client.get("/api/repairs")).json()) as unknown[];
    expect(first).toHaveLength(1);

    reportItem = false;
    const second = (await (await client.get("/api/repairs")).json()) as unknown[];
    expect(second).toHaveLength(0);
  });
});
