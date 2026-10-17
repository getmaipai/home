import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { statusEvents } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { composerNotice } from "@/lib/failureCopy";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { __resetChatPauseTrackingForTests, collectHealth } from "@/lib/healthSnapshot";
import { chatPauseSummary, recordStatusSample, __setStatusHistoryHealthForTests } from "@/lib/statusHistory";
import { chatPauseGate } from "./chatPauseGate";
import { resetDb } from "../../tests/reset-db";

afterAll(() => { __setRoleHealthForTests({}); __setStatusHistoryHealthForTests(undefined); __resetChatPauseTrackingForTests(); resetDb(); });

function app() {
  const a = new Hono();
  a.use("*", chatPauseGate);
  a.post("/api/turn/stream", (c) => c.json({ ok: true }));
  a.post("/api/turn/t1/cancel", (c) => c.json({ ok: true }));
  a.get("/api/turn/x", (c) => c.json({ ok: true }));
  return a;
}

beforeEach(() => { resetDb(); __setRoleHealthForTests({}); __resetChatPauseTrackingForTests(); __setStatusHistoryHealthForTests(undefined); });

describe("admin chat pause", () => {
  test("off: every route steps aside", async () => {
    expect((await app().request("/api/turn/stream", { method: "POST" })).status).toBe(200);
  });

  test("on: a new turn gets a plain 503 with Retry-After; cancel and reads stay open", async () => {
    setHouseholdSettingValue("chat.paused", true);
    setHouseholdSettingValue("chat.paused_message", "Back after dinner.");
    const refused = await app().request("/api/turn/stream", { method: "POST" });
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("300");
    const body = (await refused.json()) as { error: string; code: string };
    expect(body.code).toBe("chat_paused");
    expect(body.error).toBe("Chat is paused by an admin until it is turned back on. Back after dinner.");
    expect((await app().request("/api/turn/t1/cancel", { method: "POST" })).status).toBe(200);
    expect((await app().request("/api/turn/x")).status).toBe(200);
  });

  test("the setting itself stays writable while paused, so an admin can turn it back off", () => {
    setHouseholdSettingValue("chat.paused", true);
    expect(setHouseholdSettingValue("chat.paused", false).ok).toBe(true);
  });

  test("the health row shows the pause through the existing notice", async () => {
    setHouseholdSettingValue("chat.paused", true);
    const chat = (await collectHealth()).engines.chat;
    expect(chat.availability).toBe("unavailable");
    expect(chat.cause).toBe("paused_by_admin");
    expect(chat.notice?.adult).toContain("paused by an admin");
    expect(chat.notice?.child).not.toContain("admin");
  });
});

describe("pause causes", () => {
  test("each cause has its own words on the same notice", () => {
    expect(composerNotice("unavailable", "restarting")?.adult).toBe("The AI is restarting. Chat will start again by itself in a minute.");
    expect(composerNotice("unavailable", "memory")?.adult).toContain("low on memory");
    expect(composerNotice("unavailable", "offline")?.adult).toBe("The AI isn't answering.");
    expect(composerNotice("ready", "restarting")).toBeNull();
  });

  test("a Stack that stays unreachable past a minute reads as not answering", async () => {
    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "stack_unreachable", cause: "restarting" } });
    expect((await collectHealth()).engines.chat.notice?.adult).toContain("restarting");
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try { expect((await collectHealth()).engines.chat.notice?.adult).toBe("The AI isn't answering."); } finally { Date.now = realNow; }
  });

  test("the event log counts automatic pauses by cause for the day", async () => {
    const at = new Date();
    const day = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
    const health = async (cause?: "restarting" | "memory", availability: "unavailable" | "ready" = "unavailable") => {
      __setRoleHealthForTests({ chat: availability === "ready" ? { availability: "ready", reason: null } : { availability: "unavailable", reason: "x", ...(cause ? { cause } : {}) } });
      __setStatusHistoryHealthForTests(await collectHealth());
    };
    await health("restarting"); await recordStatusSample(day(0));
    await health(undefined, "ready"); await recordStatusSample(day(1));
    await health("restarting"); await recordStatusSample(day(2));
    await health(undefined, "ready"); await recordStatusSample(day(3));
    await health("memory"); await recordStatusSample(day(4));
    const rows = db.select().from(statusEvents).where(eq(statusEvents.component, "chat")).all();
    expect(rows.filter((row) => row.state === "outage").map((row) => row.detail)).toEqual(["restarting", "restarting", "memory"]);
    const summary = chatPauseSummary(day(5));
    expect(summary.count).toBe(3);
    expect(summary.line).toBe("Chat was paused 3 times today: restarting (2), low memory (1).");
  });
});
