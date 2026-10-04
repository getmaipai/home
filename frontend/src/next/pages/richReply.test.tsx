// UI-1 (gap matrix A3): what a reply with code, math, tables, task lists and
// links actually renders, through the same MarkdownText the chat and the
// canvas both mount (NextChatPage.tsx, THIN-5F). The canvas has no message
// around its text, so it mounts the same MarkdownText through MarkdownDocument. The first block pins what
// the kit already renders, so the BACKLOG's "kit support" claim is proven on
// a real DOM; the second pins Home's own token-only restyle (chatReplyMarkdown.css).
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MarkdownDocument } from "@/next/pages/MarkdownDocument";
import { RICH_REPLY_MARKDOWN } from "@/next/pages/richReplyFixture";

afterEach(cleanup);

function renderReply(text: string) {
  return render(
    <MarkdownDocument text={text} />,
  );
}

describe("a reply with every rich element (UI-1, A3)", () => {
  test("a fenced block shows its language and a Copy button", async () => {
    const { container, getAllByRole } = renderReply(RICH_REPLY_MARKDOWN);
    await waitFor(() => expect(container.querySelector(".aui-shiki-base")).toBeTruthy());
    const languages = [...container.querySelectorAll(".aui-code-header-language")].map((n) => n.textContent);
    expect(languages).toContain("typescript");
    expect(container.querySelectorAll(".aui-code-header-root button").length).toBe(3);
    expect(getAllByRole("button", { name: "Copy" }).length).toBe(3);
  });

  test("inline code, inline math and block math render", async () => {
    const { container } = renderReply(RICH_REPLY_MARKDOWN);
    expect(container.querySelector(".aui-md-inline-code")?.textContent).toBe("Array.map");
    await waitFor(() => expect(container.querySelectorAll(".katex").length).toBe(2));
    expect(container.querySelectorAll(".katex-display").length).toBe(1);
  });

  test("a table sits in its own horizontal scroller, so a phone never scrolls the page", () => {
    const { container } = renderReply(RICH_REPLY_MARKDOWN);
    const wrapper = container.querySelector(".aui-md-table-wrapper");
    expect(wrapper?.className).toContain("overflow-x-auto");
    expect(wrapper?.querySelectorAll("tbody tr").length).toBe(3);
    expect(wrapper?.querySelectorAll("th").length).toBe(5);
  });

  test("a task list shows checked and unchecked boxes the reader cannot toggle", () => {
    const { container } = renderReply(RICH_REPLY_MARKDOWN);
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(container.querySelectorAll("li.task-list-item").length).toBe(2);
  });

  test("a link opens a new tab and tells the site nothing", () => {
    const { container } = renderReply(RICH_REPLY_MARKDOWN);
    const link = container.querySelector('a[href^="https://developer.mozilla.org"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  test("a Mermaid fence draws a diagram, not code", async () => {
    const { container } = renderReply(RICH_REPLY_MARKDOWN);
    await waitFor(() => expect(container.querySelector('[data-slot="mermaid-diagram"]')).toBeTruthy());
  });
});

describe("Home's token-only restyle of the shipped reply markdown (UI-1)", () => {
  const css = () => readFileSync(join(import.meta.dir, "chatReplyMarkdown.css"), "utf8");

  test("a fence with no language is labelled text, not left blank", () => {
    expect(css()).toMatch(/\.aui-code-header-language:empty::before\s*{[^}]*content:\s*"text"/);
  });

  test("a task item drops its bullet so the checkbox is the marker", () => {
    expect(css()).toMatch(/\.aui-md\s+li\.task-list-item\s*{[^}]*list-style:\s*none/);
  });

  test("the chat page loads the stylesheet", () => {
    const page = readFileSync(join(import.meta.dir, "NextChatPage.tsx"), "utf8");
    expect(page).toContain('import "@/next/pages/chatReplyMarkdown.css";');
  });
});
