import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { createAttachment, getAttachment } from "@/lib/attachments";
import { createShare, deleteShare, listFilesVisibleToActor } from "@/lib/shares";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { conversationTurns } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { eq } from "drizzle-orm";
import { listPending } from "@/lib/notifications";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";

beforeEach(() => resetDb());

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

function person(role: "owner" | "admin" | "adult" | "teen" | "child" | "guest", displayName: string) {
  return db
    .insert(people)
    .values({
      id: newPersonId(),
      displayName,
      role,
      avatarSeed: displayName.toLowerCase(),
      source: "hub",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .returning()
    .get()!;
}

function turnFor(actor: typeof people.$inferSelect, conversationId: string) {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId: actor.id,
      surface: "chat",
      conversationId,
      userText: "attached note",
      replyText: "saved",
      source: "model",
      safetyAction: "allow",
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  return id;
}

function conversationFor(actor: typeof people.$inferSelect) {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function uploadFile(actor: typeof people.$inferSelect, text = "picture bytes") {
  const conversationId = conversationFor(actor);
  const turnId = turnFor(actor, conversationId);
  const created = createAttachment(actor, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(text) });
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

describe("share visibility", () => {
  test("a shared file is listed for the recipient and not for a third person", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const shared = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(shared.ok).toBe(true);

    const luciaLibrary = listFilesVisibleToActor(lucia);
    const luciaEntry = luciaLibrary.find((row) => row.file.id === file.id);
    expect(luciaEntry).toBeDefined();
    expect(luciaEntry?.ownerPersonId).toBe(ownerPerson.id);
    expect(luciaEntry?.shared).toBe(true);

    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(false);
    expect(getAttachment(lucia, file.id).ok).toBe(true);
    expect(getAttachment(marlow, file.id).ok).toBe(false);
  });

  test("a household-wide share is visible to every other active person", async () => {
    const ownerPerson = await owner();
    const bramble = person("child", "Bramble");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    expect(createShare(ownerPerson, { fileId: file.id, to: "household" }).ok).toBe(true);

    expect(listFilesVisibleToActor(bramble).some((row) => row.file.id === file.id)).toBe(true);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);
  });

  test("unsharing removes it at once", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const file = uploadFile(ownerPerson);
    const shared = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === file.id)).toBe(true);
    const removed = deleteShare(ownerPerson, shared.value.id);
    expect(removed.ok).toBe(true);
    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === file.id)).toBe(false);
    expect(getAttachment(lucia, file.id).ok).toBe(false);
  });
});

describe("sharing bounds (household-storage-2026-09-23.md decisions 2 and 6)", () => {
  test("a child may share their own file with the household and with another person", () => {
    const bramble = person("child", "Bramble");
    const lucia = person("adult", "Lucia");
    const file = uploadFile(bramble);

    expect(createShare(bramble, { fileId: file.id, to: "household" }).ok).toBe(true);
    expect(createShare(bramble, { fileId: file.id, to: lucia.id }).ok).toBe(true);
  });

  test("sharing with a person the household does not have is refused - the household bound", () => {
    const bramble = person("child", "Bramble");
    const file = uploadFile(bramble);

    expect(createShare(bramble, { fileId: file.id, to: newPersonId() })).toEqual({
      ok: false,
      status: 400,
      error: "the household does not have that person",
    });
  });

  test("an adult may re-share anything shared with them, within the household", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const shared = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(shared.ok).toBe(true);

    const reshared = createShare(lucia, { fileId: file.id, to: marlow.id });
    expect(reshared.ok).toBe(true);
    if (reshared.ok) expect(reshared.value.from_person_id).toBe(lucia.id);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);
  });

  test("a child re-shares only within the household - a real household target succeeds", async () => {
    const ownerPerson = await owner();
    const bramble = person("child", "Bramble");
    const cosmo = person("child", "Cosmo");
    const file = uploadFile(ownerPerson);

    expect(createShare(ownerPerson, { fileId: file.id, to: bramble.id }).ok).toBe(true);
    const reshared = createShare(bramble, { fileId: file.id, to: cosmo.id });
    expect(reshared.ok).toBe(true);
    expect(listFilesVisibleToActor(cosmo).some((row) => row.file.id === file.id)).toBe(true);
  });

  test("someone with no access to a file cannot share it", async () => {
    const ownerPerson = await owner();
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    expect(createShare(marlow, { fileId: file.id, to: "household" })).toEqual({
      ok: false,
      status: 403,
      error: "you do not have access to this file",
    });
  });
});

describe("re-share cascade on unshare", () => {
  test("deleting a household share prunes a re-share that depended solely on it", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const householdShare = createShare(ownerPerson, { fileId: file.id, to: "household" });
    expect(householdShare.ok).toBe(true);
    if (!householdShare.ok) return;
    expect(createShare(lucia, { fileId: file.id, to: marlow.id }).ok).toBe(true);

    const removed = deleteShare(ownerPerson, householdShare.value.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.deletedShareIds).toHaveLength(2);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(false);
  });

  test("revoking a direct share prunes a household-wide share its recipient made from it (no self-justifying cycle)", async () => {
    // Regression for a code-review finding (2026-09-27): a first cut of
    // pruneUnreachableShares folded every row's `to` into "reachable"
    // unconditionally, including a household-wide row's own creator -
    // so lucia's own household share counted HER as reachable simply
    // because her own row named "household," and it survived her
    // direct access being revoked forever.
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const direct = createShare(ownerPerson, { fileId: file.id, to: lucia.id });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(createShare(lucia, { fileId: file.id, to: "household" }).ok).toBe(true);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);

    const removed = deleteShare(ownerPerson, direct.value.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.deletedShareIds).toHaveLength(2);
    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === file.id)).toBe(false);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(false);
  });

  test("a re-share survives when the re-sharer still has their own direct share", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    const householdShare = createShare(ownerPerson, { fileId: file.id, to: "household" });
    expect(createShare(ownerPerson, { fileId: file.id, to: lucia.id }).ok).toBe(true);
    expect(createShare(lucia, { fileId: file.id, to: marlow.id }).ok).toBe(true);
    expect(householdShare.ok).toBe(true);
    if (!householdShare.ok) return;

    const removed = deleteShare(ownerPerson, householdShare.value.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value.deletedShareIds).toEqual([householdShare.value.id]);
    expect(listFilesVisibleToActor(marlow).some((row) => row.file.id === file.id)).toBe(true);
  });
});

describe("sharing notifies (NOTIFY-SHARE-01, docs/plans/people-profile-2026-09-26.md)", () => {
  test("sharing with a named person fires file.shared_with_you to them only - not the household, not a third person", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    expect(createShare(ownerPerson, { fileId: file.id, to: lucia.id }).ok).toBe(true);
    await __drainBackgroundWorkForTests();

    const luciaPending = listPending(lucia);
    expect(luciaPending.length).toBe(1);
    expect(luciaPending[0]!.typeId).toBe("file.shared_with_you");
    expect(luciaPending[0]!.text).toBe("Sage shared a photo with you.");
    expect(luciaPending[0]!.toast).toBe(false);

    expect(listPending(marlow).length).toBe(0);
    // The sharer isn't the "person" audience's own target, so they get
    // no delivery about their own action either.
    expect(listPending(ownerPerson).length).toBe(0);
  });

  test("sharing with the household fires file.shared_with_household to everyone reachable, age no bar", async () => {
    const ownerPerson = await owner();
    const bramble = person("child", "Bramble");
    const marlow = person("adult", "Marlow");
    const file = uploadFile(ownerPerson);

    expect(createShare(ownerPerson, { fileId: file.id, to: "household" }).ok).toBe(true);
    await __drainBackgroundWorkForTests();

    for (const recipient of [bramble, marlow]) {
      const pending = listPending(recipient);
      expect(pending.length).toBe(1);
      expect(pending[0]!.typeId).toBe("file.shared_with_household");
      expect(pending[0]!.text).toBe("Sage shared a photo with the household.");
      expect(pending[0]!.toast).toBe(false);
    }

    // The sharer is an active household member too, so resolveRecipients()'s
    // "household" branch would otherwise return them along with everyone
    // else - a code review (2026-09-27) caught the first cut of this
    // telling Sage that Sage shared a photo with the household.
    expect(listPending(ownerPerson).length).toBe(0);
  });

  test("a direct share to one person never fires the household type to a bystander, and vice versa - the two types are independent", async () => {
    // marlow is neither the direct share's own recipient nor (in this
    // test) ever named by a household share, so marlow is the clean
    // check: lucia herself would legitimately collect BOTH types once a
    // separate household share also happens (she's an active household
    // member too, same as anyone else) - that's correct fan-out, not a
    // leak, so it isn't what this test pins.
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const marlow = person("adult", "Marlow");
    const directFile = uploadFile(ownerPerson, "direct-share bytes");

    expect(createShare(ownerPerson, { fileId: directFile.id, to: lucia.id }).ok).toBe(true);
    await __drainBackgroundWorkForTests();

    expect(listPending(lucia).map((d) => d.typeId)).toEqual(["file.shared_with_you"]);
    expect(listPending(marlow).length).toBe(0); // no household share happened, so marlow gets neither type

    const householdFile = uploadFile(ownerPerson, "household-share bytes");
    expect(createShare(ownerPerson, { fileId: householdFile.id, to: "household" }).ok).toBe(true);
    await __drainBackgroundWorkForTests();

    // marlow now gets file.shared_with_household from the household
    // share, and only that - never file.shared_with_you, which was
    // never fired at (or about) marlow at all.
    expect(listPending(marlow).map((d) => d.typeId)).toEqual(["file.shared_with_household"]);
  });

  test("re-sharing to an already-shared target (the idempotent return) does not fire a second notification", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const file = uploadFile(ownerPerson);

    expect(createShare(ownerPerson, { fileId: file.id, to: lucia.id }).ok).toBe(true);
    expect(createShare(ownerPerson, { fileId: file.id, to: lucia.id }).ok).toBe(true); // same target again
    await __drainBackgroundWorkForTests();

    expect(listPending(lucia).length).toBe(1);
  });

  // Both types are configurable (notificationTypes.ts) with no telegram
  // in their own defaultChannels - matching memory.updated's own
  // posture. Both now also have a real settings-registry toggle key
  // (notifications.file.shared_with_you.telegram /
  // notifications.file.shared_with_household.telegram, settings/
  // notificationKeys.ts, NOTIFY-SHARE-01's follow-up), defaulting to
  // false the same way notifications.model.download_ready.telegram
  // does - so a household with Telegram fully configured and linked
  // still never gets either on Telegram until a person opts in,
  // proving neither type spams a channel it hasn't been turned on for,
  // and that the two never affect each other's channel set.
  test("neither type sends Telegram by default, even with Telegram fully configured and linked", async () => {
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const file = uploadFile(ownerPerson);
    setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");

    const originalFetch = globalThis.fetch;
    let sawCall = false;
    globalThis.fetch = ((..._args: unknown[]) => {
      sawCall = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      expect(createShare(ownerPerson, { fileId: file.id, to: lucia.id }).ok).toBe(true);
      expect(createShare(ownerPerson, { fileId: file.id, to: "household" }).ok).toBe(true);
      await __drainBackgroundWorkForTests();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(sawCall).toBe(false);
    const luciaPending = listPending(lucia);
    expect(luciaPending.length).toBe(2); // one from the direct share, one from the household fan-out
    for (const delivery of luciaPending) expect(delivery.channels).toEqual(["in_app"]);
  });

  // The settings-registry gap NOTIFY-SHARE-01's follow-up closes: a real
  // notifications.file.shared_with_you.telegram key (spec-v0.1.47) that
  // a person can actually flip on, mirroring
  // notifications.model.download_ready.telegram's own toggle-on test in
  // tests/notifications.test.ts. The sibling household type is left off
  // to prove it stays independent (same as the test above).
  test("a person can turn on Telegram for file.shared_with_you, and it fires only for that type", async () => {
    const { setHouseholdSettingValue, setValue } = await import("@/lib/settings");
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const file = uploadFile(ownerPerson);
    setHouseholdSettingValue("notifications.telegram.bot_token", "test-token");
    expect(setValue(lucia, `person:${lucia.id}`, "notifications.telegram.chat_id", "12345").ok).toBe(true);
    expect(setValue(lucia, `person:${lucia.id}`, "notifications.file.shared_with_you.telegram", true).ok).toBe(true);

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((url: string) => {
      calls++;
      expect(url).toContain("api.telegram.org/bottest-token/sendMessage");
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      expect(createShare(ownerPerson, { fileId: file.id, to: lucia.id }).ok).toBe(true);
      expect(createShare(ownerPerson, { fileId: file.id, to: "household" }).ok).toBe(true);
      await __drainBackgroundWorkForTests();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toBe(1); // only the direct share fired Telegram
    const luciaPending = listPending(lucia);
    expect(luciaPending.length).toBe(2);
    const directDelivery = luciaPending.find((d) => d.typeId === "file.shared_with_you")!;
    const householdDelivery = luciaPending.find((d) => d.typeId === "file.shared_with_household")!;
    expect(directDelivery.channels).toEqual(["in_app", "telegram"]);
    expect(householdDelivery.channels).toEqual(["in_app"]); // never opted in, stays in_app-only
  });
});

describe("dedupe - no duplicates at any level (STORE-SPEC-01)", () => {
  test("a second person's identical bytes become a share pointer to the first person's file", async () => {
    const ownerPerson = await owner();
    const lucia = person("adult", "Lucia");
    const bytes = "identical photo bytes";
    const first = uploadFile(ownerPerson, bytes);

    const conversationId = conversationFor(lucia);
    const turnId = turnFor(lucia, conversationId);
    const second = createAttachment(lucia, { conversationId, turnId, mediaType: "image/png", bytes: new TextEncoder().encode(bytes) });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.id).toBe(first.id);
    expect(second.value.owner_person_id).toBe(ownerPerson.id);
    expect(db.select().from(attachments).all()).toHaveLength(1);
    expect(getAttachment(lucia, first.id).ok).toBe(true);
    expect(listFilesVisibleToActor(lucia).some((row) => row.file.id === first.id)).toBe(true);
  });

  test("the same person re-uploading identical bytes doesn't create a duplicate row", async () => {
    const ownerPerson = await owner();
    const bytes = "same person, same bytes";
    const first = uploadFile(ownerPerson, bytes);
    const second = uploadFile(ownerPerson, bytes);

    expect(second.id).toBe(first.id);
    expect(db.select().from(attachments).all()).toHaveLength(1);
  });
});
