import { afterEach, describe, expect, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { THREAD_SLOTS } from "@/apps/chat/elementBindings";
import { preprocessChatMarkdown, holdTail } from "@/apps/chat/chatStreamingMarkdown";

afterEach(cleanup);

function visibleText(markdown: string): string {
  const html = renderToStaticMarkup(createElement(ReactMarkdown, null, markdown));
  const element = document.createElement("div");
  element.innerHTML = html;
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

const context = { streaming: true } as const;

describe("chat streaming markdown", () => {
  test("while streaming the visible text only grows across every prefix of a sample reply", () => {
    const reply = "# Principles\n\n1. **Bold lead-in** explains *italic words* and `code`.\n\n```txt\nplain code\n```\n\nSee [1].";
    let previous = "";
    for (let end = 1; end <= reply.length; end++) {
      const visible = visibleText(preprocessChatMarkdown(reply.slice(0, end), context));
      if (!visible.startsWith(previous)) {
        throw new Error(`visible text changed at prefix ${end} (${JSON.stringify(reply.slice(0, end))}): ${JSON.stringify(previous)} -> ${JSON.stringify(visible)}`);
      }
      previous = visible;
    }
  });

  test("no literal ** or * marker is visible in any streaming prefix", () => {
    const reply = "1. **Principles of Operation:** *carefully* use `the engine`.";
    for (let end = 1; end <= reply.length; end++) {
      expect(visibleText(preprocessChatMarkdown(reply.slice(0, end), context))).not.toMatch(/\*\*?/);
    }
  });

  test("a marker-only tail is held until the next chunk", () => {
    for (const tail of ["**", "*", "- **", "1. **", "##", "```", "`", "~~"]) {
      const held = holdTail(`Existing text\n${tail}`);
      expect(held === "Existing text" || held === "Existing text\n").toBe(true);
    }
    expect(preprocessChatMarkdown("**", context)).toBe("");
    expect(preprocessChatMarkdown("**bold", context)).toBe("**bold**");
  });

  test("a half citation [1 is held and a complete [1] becomes a chip", () => {
    expect(holdTail("See [1")).toBe("See ");
    expect(preprocessChatMarkdown("See [1", context)).toBe("See");
    expect(preprocessChatMarkdown("See [1]", context)).toBe("See [1](#citation-1)");
  });

  test("the final text equals the stored reply and is not modified", () => {
    const storedReply = "# Heading\n\n**Bold**, *italic*, `code`, and [1].";
    const before = storedReply;
    const displayed = preprocessChatMarkdown(storedReply, { streaming: false });
    expect(storedReply).toBe(before);
    expect(displayed).toBe("# Heading\n\n**Bold**, *italic*, `code`, and [1](#citation-1).");
  });

  test("the chat slot repairs streaming text and leaves finished text alone", () => {
    const preprocess = THREAD_SLOTS.markdown.preprocess;
    expect(preprocess?.("**Bold", { streaming: true })).toBe("**Bold**");
    expect(preprocess?.("**Bold", { streaming: false })).toBe("**Bold");
  });

  test("code fences, a table row and a link in progress do not flicker raw", () => {
    const reply = "```ts\nconst value = `code`;\n```\n\n| Name | Value |\n| --- | --- |\n| one | [site](https://example.com) |";
    for (let end = 1; end <= reply.length; end++) {
      const text = preprocessChatMarkdown(reply.slice(0, end), context);
      expect(text).not.toContain("streamdown:");
    }
    expect(visibleText(preprocessChatMarkdown(reply, context))).toContain("const value = `code`;");

    const linkReply = "See [a stable link](https://example.com) now.";
    let previous = "";
    for (let end = 1; end <= linkReply.length; end++) {
      const visible = visibleText(preprocessChatMarkdown(linkReply.slice(0, end), context));
      if (!visible.startsWith(previous)) {
        throw new Error(`link text changed at prefix ${end} (${JSON.stringify(linkReply.slice(0, end))}): ${JSON.stringify(previous)} -> ${JSON.stringify(visible)}`);
      }
      expect(visible).not.toContain("streamdown:");
      previous = visible;
    }
  });
});
