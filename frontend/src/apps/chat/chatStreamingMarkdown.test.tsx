import { describe, expect, test } from "bun:test";
import { THREAD_SLOTS } from "@/apps/chat/elementBindings";
import { holdCitationTail, preprocessChatMarkdown } from "@/apps/chat/chatStreamingMarkdown";

describe("chat streaming markdown", () => {
  test("the Home slot delegates link completion to Streamdown through the kit", () => {
    expect(THREAD_SLOTS.markdown.remend).toEqual({ links: false, linkMode: "text-only" });
    expect(THREAD_SLOTS.markdown.preprocess).toBe(preprocessChatMarkdown);
  });

  test("only a trailing partial numeric citation is held", () => {
    expect(holdCitationTail("See [")).toBe("See ");
    expect(holdCitationTail("See [1")).toBe("See ");
    expect(holdCitationTail("See [10")).toBe("See ");
    expect(holdCitationTail("See [source")).toBe("See [source");
    expect(holdCitationTail("Existing text\n##")).toBe("Existing text\n##");
    expect(holdCitationTail("Existing **bold")).toBe("Existing **bold");
    expect(holdCitationTail("See [1]")).toBe("See [1]");
  });

  test("citation markers map after the partial citation resolves and code stays literal", () => {
    expect(preprocessChatMarkdown("See [1", { streaming: true })).toBe("See ");
    expect(preprocessChatMarkdown("See [1]", { streaming: true })).toBe("See [1](#citation-1)");
    expect(preprocessChatMarkdown("`[1]` and [2]", { streaming: true })).toBe("`[1]` and [2](#citation-2)");
  });

  test("finished stored reply text is left intact apart from citation rendering", () => {
    const storedReply = "# Heading\n\n**Bold**, *italic*, `code`, and [1].";
    const displayed = preprocessChatMarkdown(storedReply, { streaming: false });
    expect(storedReply).toBe("# Heading\n\n**Bold**, *italic*, `code`, and [1].");
    expect(displayed).toBe("# Heading\n\n**Bold**, *italic*, `code`, and [1](#citation-1).");
  });

});
