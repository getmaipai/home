import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setMusicStatusForTests, readyMusicStatusForTests } from "@/lib/music/ready";
import { resolveTurnBudgetBase } from "@/lib/turnMachine/budget";
import { __resetToolGateLatchForTests, budgetWithTurnToolGates } from "@/lib/turnMachine/toolGates";
import { resetDb } from "../reset-db";
import type { PersonRow } from "@/types";

const link = "maipai://news/story/news-1a2b3c4d";

function makePerson(role: string, id = `person-${role}`): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}

function gateInput(actor: PersonRow, overrides: Partial<Parameters<typeof budgetWithTurnToolGates>[0]> = {}) {
  return {
    budget: resolveTurnBudgetBase(undefined, "adult"),
    actor,
    band: "adult" as const,
    surface: "chat" as const,
    surfaceClass: "written" as const,
    spoken: false,
    temporary: false,
    bare: false,
    ephemeral: false,
    text: "hello",
    musicEditAvailable: () => false,
    ...overrides,
  };
}

async function offered(actor: PersonRow, overrides: Partial<Parameters<typeof budgetWithTurnToolGates>[0]> = {}): Promise<string[]> {
  return (await budgetWithTurnToolGates(gateInput(actor, overrides))).budget.tools_offered;
}

function setReady(ready: boolean): void {
  __setPictureStatusForTests(ready ? readyStatusForTests() : null);
  __setVideoStatusForTests(ready ? readyVideoStatusForTests() : null);
  __setMusicStatusForTests(ready ? readyMusicStatusForTests() : null);
}

beforeEach(() => {
  resetDb();
  __resetSettingsCacheForTests();
  __resetToolGateLatchForTests();
  setReady(false);
});

afterEach(() => {
  resetDb();
  __resetSettingsCacheForTests();
  __resetToolGateLatchForTests();
  __setPictureStatusForTests(undefined);
  __setVideoStatusForTests(undefined);
  __setMusicStatusForTests(undefined);
});

describe("conversation tool gate latch", () => {
  test("keeps ready engine tools stable within a conversation and isolated across conversations", async () => {
    const actor = makePerson("owner");
    setReady(true);
    const first = await offered(actor, { conversationId: "conversation-a" });
    setReady(false);
    const second = await offered(actor, { conversationId: "conversation-a" });
    const otherConversation = await offered(actor, { conversationId: "conversation-b" });

    expect(second).toEqual(first);
    expect(first).toContain("generate_image");
    expect(first).toContain("generate_video");
    expect(first).toContain("generate_music");
    expect(otherConversation).not.toContain("generate_image");
    expect(otherConversation).not.toContain("generate_video");
    expect(otherConversation).not.toContain("generate_music");

    const otherPerson = makePerson("owner", "person-other-owner");
    const otherPersonSameConversationId = await offered(otherPerson, { conversationId: "conversation-a" });
    expect(otherPersonSameConversationId).not.toContain("generate_image");
    expect(otherPersonSameConversationId).not.toContain("generate_video");
    expect(otherPersonSameConversationId).not.toContain("generate_music");
  });

  test("does not latch an unready engine and offers it when it becomes ready", async () => {
    const actor = makePerson("owner");
    const first = await offered(actor, { conversationId: "waiting-conversation" });
    expect(first).not.toContain("generate_image");
    expect(first).not.toContain("generate_video");
    expect(first).not.toContain("generate_music");

    setReady(true);
    const ready = await offered(actor, { conversationId: "waiting-conversation" });
    expect(ready).toContain("generate_image");
    expect(ready).toContain("generate_video");
    expect(ready).toContain("generate_music");
  });

  test("rechecks live permission gates after readiness has latched", async () => {
    const actor = makePerson("owner");
    setReady(true);
    await offered(actor, { conversationId: "permission-conversation" });
    const blocked = await offered(actor, { conversationId: "permission-conversation", bare: true });

    expect(blocked).not.toContain("generate_image");
    expect(blocked).not.toContain("generate_video");
    expect(blocked).not.toContain("generate_music");
  });

  test("latches edit_music once the conversation has music", async () => {
    const actor = makePerson("owner");
    setReady(true);
    const first = await offered(actor, { conversationId: "music-edit-conversation", musicEditAvailable: () => true });
    const second = await offered(actor, { conversationId: "music-edit-conversation", musicEditAvailable: () => false });

    expect(first).toContain("edit_music");
    expect(second).toContain("edit_music");
  });

  test("latches read_item after a link while retaining its live audience gate", async () => {
    const adult = makePerson("owner");
    const first = await offered(adult, { conversationId: "item-conversation", text: `Read this: ${link}` });
    const second = await offered(adult, { conversationId: "item-conversation", text: "What do you think?" });
    expect(first).toContain("read_item");
    expect(second).toContain("read_item");

    const child = makePerson("child", "person-child");
    const childOffers = await offered(child, { conversationId: "child-conversation", text: `Read this: ${link}`, band: "child" });
    expect(childOffers).not.toContain("read_item");

    const guest = makePerson("guest", "person-guest");
    const guestOffers = await offered(guest, { conversationId: "guest-conversation", text: `Read this: ${link}` });
    expect(guestOffers).not.toContain("read_item");
  });

  test("does not latch without a conversation id", async () => {
    const adult = makePerson("owner");
    setReady(true);
    const first = await offered(adult);
    const itemWithLink = await offered(adult, { text: link });
    setReady(false);
    const second = await offered(adult);
    const itemWithoutLink = await offered(adult, { text: "What do you think?" });

    expect(first).toContain("generate_image");
    expect(second).not.toContain("generate_image");
    expect(itemWithLink).toContain("read_item");
    expect(itemWithoutLink).not.toContain("read_item");
  });
});
