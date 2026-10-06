// CHAT-CALM-ERRORS-01d (design data-scratch/research/chat-calm-errors.md
// sections 2, 6 and 7; RULES.md rules 0 and 6): one cause, one visual. The
// composer line's words live in failureCopy.ts and reach the client on the
// health row; the Chat status app reads "paused" (amber) while the Stack is
// still inside its recovery window and "down" (red) after it; the bell gains
// nothing for a stopped engine inside that window, and a teen or a child
// never gets a Repairs notification.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import { startStackFixture, useDefaultScriptedStack, type StackFixture } from "./stackFixture";
import { __resetStackEngineForTests, __setStackClientForTests, reportStackOffline, STACK_RECOVERY_WINDOW_MS } from "@/lib/stackEngine";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { collectHealth } from "@/lib/healthSnapshot";
import { listIssues } from "@/lib/issues";
import { composerNotice } from "@/lib/failureCopy";

const STOPPED_BODY = { error: "No engine is ready for role 'chat'.", role: "chat", state: "installed", offline_reason: "The chat engine was stopped." };

let fixture: StackFixture | null = null;

beforeEach(() => {
  resetDb();
  __resetStackEngineForTests();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  fixture?.stop();
  fixture = null;
  __resetStackEngineForTests();
  __setRoleHealthForTests({});
  useDefaultScriptedStack();
});

function refusingStack(): void {
  fixture = startStackFixture({
    "POST /v1/chat/completions": async () => Response.json(STOPPED_BODY, { status: 503, headers: { "x-maipai-engine": "none", "x-maipai-model": "none" } }),
    "GET /stack/v1/roles": async () => Response.json({ roles: [{ id: "chat", state: { state: "installed", since: "scripted-test" }, reason: null }] }),
  });
  __setStackClientForTests(fixture.client);
}

async function sendOneTurn(client: TestClient): Promise<void> {
  const res = await client.post("/api/turn/stream", { text: "hi" });
  expect(res.status).toBe(200);
  await res.text();
}

type App = { id: string; state: string; reason: string | null; paused?: boolean };
async function chatApp(client: TestClient): Promise<App> {
  const apps = (await (await client.get("/api/status/apps")).json()) as App[];
  return apps.find((app) => app.id === "chat")!;
}

async function pendingTexts(client: TestClient): Promise<string[]> {
  const rows = (await (await client.get("/api/notifications")).json()) as Array<{ text: string }>;
  return rows.map((row) => row.text);
}

// raiseIssue() runs un-awaited inside reportStackOffline(); let it settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the composer line comes from one table, per band (design section 7)", () => {
  test("a paused engine: one line per band, and the Repairs link words for an admin", () => {
    expect(composerNotice("unavailable")).toEqual({
      adult: "Chat is paused. Your message stays here; press Send once it is back.",
      teen: "Chat is paused right now. Your message stays here; press Send once it is back.",
      child: "I'm taking a break. Ask a grown-up, or try again soon.",
      repairs_link: "Open Repairs",
    });
  });

  test("a starting engine: the short starting line, and no Repairs link for anyone", () => {
    expect(composerNotice("starting")).toEqual({
      adult: "Starting up. You can send in a moment.",
      teen: "Starting up. You can send in a moment.",
      child: "I'm waking up. Send that in a moment.",
      repairs_link: null,
    });
  });

  test("a ready engine has no line", () => {
    expect(composerNotice("ready")).toBeNull();
  });
});

describe("the health row carries the composer line", () => {
  test("after the stopped-engine 503, the chat row carries the paused lines", async () => {
    refusingStack();
    const { client } = await owner();
    await sendOneTurn(client);
    const health = await collectHealth();
    expect(health.engines.chat.availability).toBe("unavailable");
    expect(health.engines.chat.notice).toEqual(composerNotice("unavailable"));
  });

  test("a starting chat row carries the starting lines, a ready one none", async () => {
    __setRoleHealthForTests({ chat: { availability: "starting", reason: null } });
    expect((await collectHealth()).engines.chat.notice).toEqual(composerNotice("starting"));
    __setRoleHealthForTests({ chat: { availability: "ready", reason: null } });
    expect((await collectHealth()).engines.chat.notice ?? null).toBeNull();
  });
});

describe("the Chat status app: paused inside the recovery window, down after it", () => {
  test("a stopped engine the Stack can restart reads as paused, not down", async () => {
    refusingStack();
    const { client } = await owner();
    await sendOneTurn(client);
    expect(await chatApp(client)).toMatchObject({ state: "degraded", reason: "Chat is paused.", paused: true });
  });

  test("a starting engine is a pause too; a working chat is not", async () => {
    const { client } = await owner();
    __setRoleHealthForTests({ chat: { availability: "starting", reason: null } });
    expect(await chatApp(client)).toMatchObject({ state: "degraded", paused: true });
    __setRoleHealthForTests({ chat: { availability: "ready", reason: null } });
    expect((await chatApp(client)).paused).toBe(false);
  });

  test("a live role list that says the engine failed is down, even with a recoverable refusal still on record", async () => {
    const { client } = await owner();
    reportStackOffline("The chat engine was stopped.", "chat", undefined, "installed");
    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "failed_start" } });
    expect(await chatApp(client)).toMatchObject({ state: "down", paused: false });
  });

  test("the same engine still down past the window reads as down", async () => {
    const { client } = await owner();
    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "stack_refused" } });
    reportStackOffline("The chat engine was stopped.", "chat", undefined, "installed", Date.now() - STACK_RECOVERY_WINDOW_MS - 1_000);
    expect((await chatApp(client)).state).toBe("down");
  });

  test("a state the Stack cannot recover from on its own reads as down at once", async () => {
    const { client } = await owner();
    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "stack_refused" } });
    reportStackOffline("The chat engine waited 15 s for memory and gave up.", "chat", undefined, "offline");
    expect((await chatApp(client)).state).toBe("down");
  });
});

describe("the bell (design section 6)", () => {
  test("a stopped engine inside the recovery window raises a warning and no notification", async () => {
    refusingStack();
    const { client } = await owner();
    await sendOneTurn(client);
    await settle();
    expect(listIssues().find((issue) => issue.key === "offline.chat")?.severity).toBe("warning");
    expect(await pendingTexts(client)).not.toContain("MaiPai Stack is offline");
  });

  test("past the window the warning escalates and an admin is told once; a teen and a child never are", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const { client: childClient } = await child(client);
    const start = Date.now();
    reportStackOffline("The chat engine was stopped.", "chat", undefined, "installed", start);
    await settle();
    expect(await pendingTexts(client)).not.toContain("MaiPai Stack is offline");
    reportStackOffline("The chat engine was stopped.", "chat", undefined, "installed", start + STACK_RECOVERY_WINDOW_MS + 1_000);
    await settle();
    reportStackOffline("The chat engine was stopped.", "chat", undefined, "installed", start + STACK_RECOVERY_WINDOW_MS + 2_000);
    await settle();
    expect(listIssues().find((issue) => issue.key === "offline.chat")?.severity).toBe("error");
    expect((await pendingTexts(client)).filter((text) => text === "MaiPai Stack is offline")).toHaveLength(1);
    expect(await pendingTexts(teenClient)).not.toContain("MaiPai Stack is offline");
    expect(await pendingTexts(childClient)).not.toContain("MaiPai Stack is offline");
  });

  test("with no new request (Send is held), the window's end escalates the warning and tells an admin", async () => {
    const { client } = await owner();
    reportStackOffline("The chat engine was stopped.", "chat", undefined, "installed", Date.now() - STACK_RECOVERY_WINDOW_MS + 100);
    await settle();
    expect(listIssues().find((issue) => issue.key === "offline.chat")?.severity).toBe("warning");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(listIssues().find((issue) => issue.key === "offline.chat")?.severity).toBe("error");
    expect((await pendingTexts(client)).filter((text) => text === "MaiPai Stack is offline")).toHaveLength(1);
  });

  test("one outage notifies once: a state that flaps back to recoverable keeps the error and sends nothing new", async () => {
    const { client } = await owner();
    reportStackOffline("The chat engine waited 15 s for memory and gave up.", "chat", undefined, "offline");
    await settle();
    reportStackOffline("The chat engine was stopped.", "chat", undefined, "installed");
    await settle();
    reportStackOffline("The chat engine waited 15 s for memory and gave up.", "chat", undefined, "offline");
    await settle();
    expect(listIssues().find((issue) => issue.key === "offline.chat")?.severity).toBe("error");
    expect((await pendingTexts(client)).filter((text) => text === "MaiPai Stack is offline")).toHaveLength(1);
  });
});
