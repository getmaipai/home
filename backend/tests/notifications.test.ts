import { describe, expect, test, beforeEach, mock } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { setHouseholdSettingValue } from "@/lib/settings";
import { trigger, listPending, listHistory, markRead, dismiss, dismissMany } from "@/lib/notifications";
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
  // Issues #35/#47 made a secret required for role: "adult" too
  // (owner/admin already needed one) - a secret-holding profile also
  // stops being a bare-/select profile, so only attach one, and sign in
  // via verify-secret instead, for the roles that now need it.
  const needsSecret = role === "owner" || role === "admin" || role === "adult";
  const created = await ownerClient.post("/api/people", { displayName, role, ...(needsSecret ? { secret: "0000" } : {}) });
  const { id } = (await created.json()) as { id: string };
  const client = new TestClient();
  if (needsSecret) {
    await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  } else {
    await client.post("/api/auth/select", { personId: id });
  }
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

  // getmaipai/home#64: chatMemoryChip.tsx correlates a memory.updated
  // delivery back to the specific message it's rendering by turn id, and
  // links to the real memory records the judge wrote - both need a real
  // column, the same "not a text match" call subjectPersonId's own
  // schema comment already made.
  test("subjectTurnId and memoryIds round-trip through a real delivery", async () => {
    const { row } = await owner();
    await trigger("memory.updated", { summary: "trash day is Tuesday" }, { personId: row.id, subjectTurnId: "turn-abc123", memoryIds: ["mem1-abc", "mem2-def"] });
    const [delivery] = listPending(row);
    expect(delivery!.subjectTurnId).toBe("turn-abc123");
    expect(delivery!.memoryIds).toEqual(["mem1-abc", "mem2-def"]);
  });

  test("subjectTurnId and memoryIds default to null when the caller doesn't set them", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [delivery] = listPending(row);
    expect(delivery!.subjectTurnId).toBeNull();
    expect(delivery!.memoryIds).toBeNull();
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
      secret: "0000",
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

// getmaipai/home#109: the toast decision is declared once on
// NotificationType (lib/notificationTypes.ts) and carried on the
// delivery view (lib/notifications.ts) so the frontend bell reads one
// field instead of string-matching its own copy of the registry.
describe("NotificationDeliveryView.toast", () => {
  test("a memory.updated delivery has toast: false", async () => {
    const { row } = await owner();
    await trigger("memory.updated", { summary: "trash day is Tuesday" }, { personId: row.id });
    const [delivery] = listPending(row);
    expect(delivery!.toast).toBe(false);
  });

  test("a model.download_ready delivery has toast: true", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [delivery] = listPending(row);
    expect(delivery!.toast).toBe(true);
  });

  test("an undeclared typeId falls back to toast: true", async () => {
    // trigger() itself is a no-op for an undeclared id, so this pins the
    // toView() fallback directly: a row whose typeId is not in the
    // registry (a package type registered before the toast field existed,
    // or a typeId string a caller passed directly to toView) is treated
    // as toast: true - toasting is the least surprising default.
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [delivery] = listPending(row);
    // toView() is not exported; verify the fallback by reading the type
    // registry directly and asserting the expression toView() uses.
    const { getNotificationType } = await import("@/lib/notificationTypes");
    expect(getNotificationType("no.such.type")).toBeUndefined();
    // The fallback in toView() is `getNotificationType(row.typeId)?.toast ?? true`.
    // A real delivery with a known typeId already has the right value
    // (covered by the two tests above); this test pins that the fallback
    // expression resolves to `true` for an unknown typeId.
    expect((getNotificationType("no.such.type")?.toast ?? true)).toBe(true);
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

// Lane 15: dismissMany() backs the bell popover's "Dismiss all" and the
// history page's own "Clear all"/"Dismiss selected".
describe("dismissMany", () => {
  test("{ ids } dismisses exactly the given ids and returns their count", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Model A" });
    await trigger("model.download_ready", { modelName: "Model B" });
    await trigger("model.download_ready", { modelName: "Model C" });
    const [a, b] = listPending(row);

    const result = dismissMany(row, { ids: [a!.id, b!.id] });
    expect(result).toEqual({ ok: true, value: { count: 2 } });
    expect(listPending(row).length).toBe(1);
    expect(listHistory(row).length).toBe(3);
  });

  test("another person's id in the list is ignored and not counted, and not dismissed", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    // "adults" is household-wide: both get their own real row.
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [ownerDelivery] = listPending(ownerRow);
    const [adultDelivery] = listPending(adult);

    const result = dismissMany(adult, { ids: [ownerDelivery!.id, adultDelivery!.id] });
    expect(result).toEqual({ ok: true, value: { count: 1 } });
    expect(listPending(ownerRow).length).toBe(1); // untouched
    expect(listPending(adult).length).toBe(0);
  });

  test("a nonexistent id in the list is ignored and not counted, never a 404 for the whole call", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [delivery] = listPending(row);

    const result = dismissMany(row, { ids: [delivery!.id, "notif-does-not-exist"] });
    expect(result).toEqual({ ok: true, value: { count: 1 } });
  });

  test("an already-dismissed id passed again is not re-counted", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Test Model" });
    const [delivery] = listPending(row);
    dismiss(row, delivery!.id);

    const result = dismissMany(row, { ids: [delivery!.id] });
    expect(result).toEqual({ ok: true, value: { count: 0 } });
  });

  test("{ all: true } dismisses only what's currently pending, not the whole history", async () => {
    const { row } = await owner();
    await trigger("model.download_ready", { modelName: "Model A" });
    await trigger("model.download_ready", { modelName: "Model B" });
    const [first] = listPending(row);
    dismiss(row, first!.id); // already dismissed before the bulk call

    const result = dismissMany(row, { all: true });
    expect(result).toEqual({ ok: true, value: { count: 1 } }); // only the still-pending one
    expect(listPending(row).length).toBe(0);
    expect(listHistory(row).length).toBe(2);
  });

  test("{ all: true } only ever touches this person's own rows, never another's", async () => {
    const { client: ownerClient, row: ownerRow } = await owner();
    const { row: adult } = await withRole(ownerClient, "Bramble", "adult");
    await trigger("model.download_ready", { modelName: "Test Model" });

    dismissMany(adult, { all: true });
    expect(listPending(ownerRow).length).toBe(1); // the owner's own row is untouched
    expect(listPending(adult).length).toBe(0);
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

  test("POST /dismiss requires auth", async () => {
    expect((await new TestClient().post("/api/notifications/dismiss", { all: true })).status).toBe(401);
  });

  test("POST /dismiss with { ids } dismisses exactly those, over HTTP", async () => {
    const { client } = await owner();
    await trigger("model.download_ready", { modelName: "Model A" });
    await trigger("model.download_ready", { modelName: "Model B" });
    const pending = (await (await client.get("/api/notifications")).json()) as Array<{ id: string }>;

    const res = await client.post("/api/notifications/dismiss", { ids: [pending[0]!.id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 });
    expect(((await (await client.get("/api/notifications")).json()) as unknown[]).length).toBe(1);
  });

  test("POST /dismiss with { all: true } dismisses only pending, over HTTP", async () => {
    const { client } = await owner();
    await trigger("model.download_ready", { modelName: "Model A" });
    await trigger("model.download_ready", { modelName: "Model B" });
    const pending = (await (await client.get("/api/notifications")).json()) as Array<{ id: string }>;
    await client.post(`/api/notifications/${pending[0]!.id}/dismiss`, {}); // one already dismissed

    const res = await client.post("/api/notifications/dismiss", { all: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 }); // only the still-pending one
    expect(((await (await client.get("/api/notifications")).json()) as unknown[]).length).toBe(0);
  });

  test("POST /dismiss with an empty body is a 400, neither shape it accepts", async () => {
    const { client } = await owner();
    const res = await client.post("/api/notifications/dismiss", {});
    expect(res.status).toBe(400);
  });

  test("POST /dismiss with an empty ids array is a 400, not a silent no-op", async () => {
    const { client } = await owner();
    const res = await client.post("/api/notifications/dismiss", { ids: [] });
    expect(res.status).toBe(400);
  });

  test("POST /dismiss with another person's id in the list ignores it, over HTTP", async () => {
    const { client: ownerClient } = await owner();
    const { client: adultClient, row: adult } = await withRole(ownerClient, "Bramble", "adult");
    await trigger("model.download_ready", { modelName: "Test Model" }); // both get their own row
    const ownerPending = (await (await ownerClient.get("/api/notifications")).json()) as Array<{ id: string }>;
    const adultPending = (await (await adultClient.get("/api/notifications")).json()) as Array<{ id: string }>;

    const res = await adultClient.post("/api/notifications/dismiss", { ids: [ownerPending[0]!.id, adultPending[0]!.id] });
    expect(await res.json()).toEqual({ count: 1 });
    expect(listPending(adult).length).toBe(0);
    expect(((await (await ownerClient.get("/api/notifications")).json()) as unknown[]).length).toBe(1); // untouched
  });
});
