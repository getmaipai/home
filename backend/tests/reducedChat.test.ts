import { afterEach, describe, expect, test } from "bun:test";
import { collectHealth } from "@/lib/healthSnapshot";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { reducedChatNotice, setReducedChat } from "@/lib/reducedChat";

afterEach(() => { setReducedChat(null); __setRoleHealthForTests({}); });

describe("reduced chat line", () => {
  test("words per band, with minutes only when known", () => {
    expect(reducedChatNotice(12).adult).toBe("Chat is simpler while a big job runs (about 12 minutes). Answers are shorter and some extras may be paused.");
    expect(reducedChatNotice(null).adult).toBe("Chat is simpler while a big job runs. Answers are shorter and some extras may be paused.");
    expect(reducedChatNotice(3).child).toBe("Chat is a little simpler for a few minutes.");
  });

  test("the chat health row stays ready, carries the line, and never names an app or person", async () => {
    __setRoleHealthForTests({ chat: { availability: "ready", reason: null, cause: "tier_reduced" } });
    setReducedChat({ minutesLeft: 12 });
    const { engines } = await collectHealth();
    expect(engines.chat.availability).toBe("ready");
    expect(engines.chat.cause).toBe("tier_reduced");
    expect(engines.chat.notice?.adult).toContain("about 12 minutes");
    expect(JSON.stringify(engines.chat.notice)).not.toMatch(/video|picture|song|music/i);
  });
});
