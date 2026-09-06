import { describe, expect, test, beforeEach, mock } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { trigger, listPending, listHistory, markRead, dismiss } from "@/lib/notifications";
import { runTurn } from "@/lib/turnEngine";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

async function owner(): Promise<{ client: TestClient; row: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  return { client, row };
}

async function withRole(ownerClient: TestClient, displayName: string, role: string): Promise<{ client: TestClient; row: PersonRow }> {
  const created = await ownerClient.post("/api/people", { displayName, role });
  const { id } = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  const row = db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
  return { client, row };
}

async function setPersonSetting(client: TestClient, personId: string, key: string, value: unknown) {
  const res = await client.request("/api/settings", { method: "PUT", body: { scope: `person:${personId}`, key, value } });
  expect(res.status).toBe(200);
}

describe("trigger()", () => {
  test("an undeclared type id is a no-op, not a throw", async () => {
    await trigger("no.such.type", {});
  });

  test("a household audience type delivers to every non-minor, not to minors", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: teen } = await withRole(ownerClient, "Bramble", "teen");
    await trigger("model.download_ready", { modelName: "Test Model" });

    expect(listPending(ownerRow).length).toBe(1);
    expect(listPending(teen).length).toBe(0);
  });

  test("renders the template with the given vars", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Qwen3 8B" });
    const [delivery] = listPending(row);
    expect(delivery!.text).toBe("Qwen3 8B finished downloading and is ready to use.");
  });

  // No real person-audience core type exists yet (both declared types are
  // "adults" - lib/notificationTypes.ts), so `resolveRecipients`'s
  // `person`-audience branch has no bundled-type test of its own; this
  // instead pins the "adults" fan-out reaching more than one real
  // recipient, not just a household of one.
  test("an \"adults\" audience type reaches every adult, not just the one who triggered it", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    await trigger("safety.flagged_turn", { childName: "Bramble", categories: "self_harm" });
    expect(listPending(ownerRow).length).toBe(1);
    expect(listPending(adult).length).toBe(1);
  });

  // Session C step 7 (session-c-brain-and-voice.md): a code review found
  // resolveRecipients()'s own "adults" filter used to share the same
  // role proxy evaluateSafety() used before that step - the two agreed
  // by construction. Once evaluateSafety() switched to the real
  // birthdate-derived band, a role-only audience filter here could
  // diverge from it: a minor mislabeled with an "adult" role would be
  // excluded from evaluateSafety()'s own minor protections but still
  // counted as an eligible "adults" recipient - for this exact
  // notification type, a minor receiving their own (or a sibling's)
  // flagged-turn notification, the precise leak notify_parent exists to
  // prevent. Proves the fix: a real 15-year-old with a stale "adult"
  // role label never receives this notification.
  test("a minor with a stale 'adult' role label is never counted as an eligible \"adults\" recipient", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const fifteenYearsAgo = new Date();
    fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
    const created = await ownerClient.post("/api/people", {
      displayName: "Marlow",
      role: "adult",
      birthdate: fifteenYearsAgo.toISOString().slice(0, 10),
    });
    const { id } = (await created.json()) as { id: string };
    const teenRow = db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;

    await trigger("safety.flagged_turn", { childName: "Marlow", categories: "self_harm" });
    expect(listPending(ownerRow).length).toBe(1);
    expect(listPending(teenRow).length).toBe(0);
  });

  test("in_app always delivers even with no Telegram configured", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    expect(listPending(row)[0]!.channels).toEqual(["in_app"]);
  });

  // A code review (2026-09-05) found the persisted `channels` list
  // claimed "telegram" was attempted purely from the type's own
  // defaultChannels/preference check, before ever confirming the
  // recipient had a real chat id to send to - so a household that never
  // finished Telegram setup got a delivery row lying about what
  // actually happened, most visibly for this exact non-configurable
  // safety type (its own defaultChannels include "telegram" always).
  test("a non-configurable type's persisted channels never claim Telegram was attempted when no chat id is linked", async () => {
    const originalFetch = globalThis.fetch;
    let sawCall = false;
    globalThis.fetch = mock(() => {
      sawCall = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const { row } = await owner();
      setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");
      // Deliberately never links a chat id.
      await trigger("safety.flagged_turn", { childName: "Bramble", categories: "self_harm" });
      expect(sawCall).toBe(false);
      expect(listPending(row)[0]!.channels).toEqual(["in_app"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // safety.flagged_turn has no settings-key toggle at all (it's
  // non-configurable - lib/notificationTypes.ts's own header explains
  // why), so its Telegram delivery is driven entirely by its own
  // defaultChannels, never a per-person preference read.
  test("a non-configurable type's Telegram default fires once configured and linked, with no per-type toggle to set", async () => {
    const originalFetch = globalThis.fetch;
    let sawCall = false;
    globalThis.fetch = mock(() => {
      sawCall = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const { client, row } = await owner();
      setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");
      await setPersonSetting(client, row.id, "notifications.telegram.chat_id", "12345");

      await trigger("safety.flagged_turn", { childName: "Bramble", categories: "self_harm" });
      expect(sawCall).toBe(true);
      expect(listPending(row)[0]!.channels).toEqual(["in_app", "telegram"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Telegram fires for a configurable type only when the recipient opted in AND linked a chat id", async () => {
    const originalFetch = globalThis.fetch;
    let sawCall = false;
    globalThis.fetch = mock((url: string) => {
      sawCall = true;
      expect(url).toContain("api.telegram.org/bottest-token/sendMessage");
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const { client, row } = await owner();
      setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");
      await setPersonSetting(client, row.id, "notifications.telegram.chat_id", "12345");
      await setPersonSetting(client, row.id, "notifications.model.download_ready.telegram", true);

      await trigger("model.download_ready", { modelName: "Test Model" });
      expect(sawCall).toBe(true);
      expect(listPending(row)[0]!.channels).toEqual(["in_app", "telegram"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Telegram does not fire for a configurable type when the recipient never opted in", async () => {
    const originalFetch = globalThis.fetch;
    let sawCall = false;
    globalThis.fetch = mock(() => {
      sawCall = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const { client, row } = await owner();
      setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");
      await setPersonSetting(client, row.id, "notifications.telegram.chat_id", "12345");
      // Deliberately never sets notifications.model_download_ready.telegram.

      await trigger("model.download_ready", { modelName: "Test Model" });
      expect(sawCall).toBe(false);
      expect(listPending(row)[0]!.channels).toEqual(["in_app"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // The real, previously-unrealized gap this whole slice exists to close:
  // safety.ts's evaluateSafety() has computed notify_parent since it was
  // written, but nothing before this delivered it anywhere but a
  // console.log line.
  test("a minor's safety-flagged turn notifies every adult in the household for real, through runTurn()", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const child = await withRole(ownerClient, "Bramble", "child");

    const result = await runTurn(child.row, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);

    const pending = listPending(ownerRow);
    expect(pending.length).toBe(1);
    expect(pending[0]!.typeId).toBe("safety.flagged_turn");
    expect(pending[0]!.text).toContain("Bramble");
    expect(pending[0]!.text).toContain("harmful_request");
  });

  test("a non-flagged turn never notifies", async () => {
    const { row: ownerRow } = await owner();
    await runTurn(ownerRow, "chat", "hi there");
    expect(listPending(ownerRow).length).toBe(0);
  });
});

describe("listPending / listHistory / markRead / dismiss", () => {
  test("dismiss removes a delivery from the pending list but keeps it in history", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [delivery] = listPending(row);

    const result = dismiss(row, delivery!.id);
    expect(result.ok).toBe(true);
    expect(listPending(row).length).toBe(0);
    expect(listHistory(row).length).toBe(1);
  });

  test("markRead sets readAt without affecting the pending list", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [delivery] = listPending(row);
    expect(delivery!.readAt).toBeNull();

    const result = markRead(row, delivery!.id);
    expect(result.ok).toBe(true);
    expect(listPending(row)[0]!.readAt).not.toBeNull();
  });

  test("a person cannot read or dismiss another person's own delivery row", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    // "adults" is a household-wide audience, so both the owner and this
    // adult get their OWN real delivery row - the isolation this test
    // checks is that neither can act on the OTHER's row by id, not that
    // the type only reaches one of them.
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [ownerDelivery] = listPending(ownerRow);
    expect(listPending(adult).length).toBe(1);

    expect(markRead(adult, ownerDelivery!.id).ok).toBe(false);
    expect(dismiss(adult, ownerDelivery!.id).ok).toBe(false);
  });

  test("dismissing or reading a nonexistent notification is a 404", async () => {
    const { row } = await owner();
    expect(markRead(row, "notif-does-not-exist").ok).toBe(false);
    expect(dismiss(row, "notif-does-not-exist").ok).toBe(false);
  });
});

describe("HTTP: /api/notifications", () => {
  test("requires auth", async () => {
    expect((await new TestClient().get("/api/notifications")).status).toBe(401);
  });

  test("a person can list, read, and dismiss their own notifications over HTTP", async () => {
    const { client } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });

    const pending = (await (await client.get("/api/notifications")).json()) as Array<{ id: string; readAt: string | null }>;
    expect(pending.length).toBe(1);
    expect(pending[0]!.readAt).toBeNull();

    const read = await client.post(`/api/notifications/${pending[0]!.id}/read`, {});
    expect(read.status).toBe(200);

    const dismissed = await client.post(`/api/notifications/${pending[0]!.id}/dismiss`, {});
    expect(dismissed.status).toBe(200);

    expect(((await (await client.get("/api/notifications")).json()) as unknown[]).length).toBe(0);
    const history = (await (await client.get("/api/notifications/history")).json()) as unknown[];
    expect(history.length).toBe(1);
  });
});
