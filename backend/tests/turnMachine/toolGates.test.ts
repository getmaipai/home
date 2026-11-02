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

describe("MUSIC-LIKE-01: make_band follows a song reference, never the wording", () => {
  const track = "maipai://music/track/media-a1b2c3d4e5";
  test("a song reference on a music turn offers make_band and not read_item; wording alone offers neither", async () => {
    const adult = makePerson("owner");
    setReady(true);
    const withRef = await offered(adult, { text: `Create a band like this: ${track}` });
    const wordsOnly = await offered(adult, { text: "make me a band like the song I am playing" });
    expect(withRef).toContain("make_band");
    expect(withRef).not.toContain("read_item");
    expect(wordsOnly).not.toContain("make_band");
  });
  test("without music, a child or a guest, or with a news link too, make_band is not offered", async () => {
    const adult = makePerson("owner");
    expect(await offered(adult, { text: track })).not.toContain("make_band");
    setReady(true);
    const mixed = await offered(adult, { text: `${track} and ${link}` });
    expect(mixed).toContain("read_item");
    expect(mixed).not.toContain("make_band");
    const child = makePerson("child", "person-child");
    expect(await offered(child, { text: track, band: "child" })).not.toContain("make_band");
    const guest = makePerson("guest", "person-guest");
    expect(await offered(guest, { text: track })).not.toContain("make_band");
  });
  test("every other gate on at once still fits the sixteen-tool cap", async () => {
    const adult = makePerson("owner");
    setReady(true);
    const all = await offered(adult, { text: track, musicEditAvailable: () => true });
    expect(all).toContain("make_band");
    expect(all.length).toBeLessThanOrEqual(16);
  });
  test("the offer latches for the chat and still needs the live music gate", async () => {
    const adult = makePerson("owner");
    setReady(true);
    expect(await offered(adult, { conversationId: "band-chat", text: track })).toContain("make_band");
    expect(await offered(adult, { conversationId: "band-chat", text: "make it darker" })).toContain("make_band");
    const spoken = await offered(adult, { conversationId: "band-chat", text: "make it darker", surfaceClass: "spoken", spoken: true });
    expect(spoken).not.toContain("make_band");
  });
});


describe("VIDEO-CHAT-01: edit_video is offered only where a clip exists and a video may be made", () => {
  test("an adult with video ready and a finished clip in the chat is offered it; with no clip, or no engine, it is not", async () => {
    const adult = makePerson("owner");
    setReady(true);
    expect(await offered(adult, { videoEditAvailable: () => true })).toContain("edit_video");
    expect(await offered(adult, { videoEditAvailable: () => false })).not.toContain("edit_video");
    expect(await offered(adult)).not.toContain("edit_video");
    expect(await offered(adult, { videoEditAvailable: () => true })).toContain("generate_video");
    setReady(false);
    expect(await offered(adult, { videoEditAvailable: () => true })).not.toContain("edit_video");
  });
  test("a teen, a child, a guest, a spoken turn and a bare turn are never offered it, clip or not", async () => {
    setReady(true);
    const yes = { videoEditAvailable: () => true };
    expect(await offered(makePerson("child", "person-child"), { ...yes, band: "child" })).not.toContain("edit_video");
    expect(await offered(makePerson("teen", "person-teen"), { ...yes, band: "teen" })).not.toContain("edit_video");
    expect(await offered(makePerson("guest", "person-guest"), yes)).not.toContain("edit_video");
    expect(await offered(makePerson("owner"), { ...yes, surfaceClass: "spoken", spoken: true })).not.toContain("edit_video");
    expect(await offered(makePerson("owner", "person-second-owner"), { ...yes, bare: true })).not.toContain("edit_video");
  });
  test("it latches for the chat once a clip exists and still needs the live gates", async () => {
    const adult = makePerson("owner");
    setReady(true);
    expect(await offered(adult, { conversationId: "video-edit-chat", videoEditAvailable: () => true })).toContain("edit_video");
    expect(await offered(adult, { conversationId: "video-edit-chat" })).toContain("edit_video");
    expect(await offered(adult, { conversationId: "video-edit-chat", bare: true })).not.toContain("edit_video");
  });
  test("every other gate on at once, with the planned link reader, still fits sixteen and keeps the video set", async () => {
    const adult = makePerson("owner");
    setReady(true);
    const all = await offered(adult, { text: link, musicEditAvailable: () => true, videoEditAvailable: () => true });
    expect(all).toContain("edit_video");
    expect(all).toContain("generate_video");
    expect(all.length).toBeLessThanOrEqual(16);
  });
});
