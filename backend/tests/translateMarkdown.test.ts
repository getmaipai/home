import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { splitMarkdown, joinMarkdown } from "../src/lib/translate/markdown";

const root = join(import.meta.dir, "../..");
describe("Markdown translation segments", () => {
  test("identity round trips every user page and selected site pages byte for byte", () => {
    const user = readdirSync(join(root, "docs/user"), { recursive: true }).filter((file) => typeof file === "string" && file.endsWith(".md")).map((file) => join(root, "docs/user", file as string));
    const site = ["index.mdx", "user/index.mdx", "admin/index.mdx"].map((file) => join(root, "docs/site-fumadocs/content/docs", file));
    for (const file of [...user, ...site]) { const source = readFileSync(file, "utf8"); const segments = splitMarkdown(source).segments; expect(joinMarkdown(source, segments, segments.map((entry) => entry.text))).toBe(source); }
  });
  test("replacement preserves code, links, and table separators", () => {
    const source = "---\ntitle: Hi\nother: Fixed\n---\n\n| Name | Link |\n| --- | --- |\n| **Hello** | [there](https://example.test/a) |\n\n`inline`\n\n```ts\nconst a = 1;\n```\n";
    const segments = splitMarkdown(source).segments;
    const output = joinMarkdown(source, segments, segments.map((entry) => entry.text.toUpperCase()));
    expect(output).toContain("https://example.test/a");
    expect(output).toContain("| NAME | LINK |");
    expect(output).toContain("`inline`");
    expect(output).toContain("const a = 1;");
    expect(output).toContain("other: Fixed");
    expect(output).toContain("| **HELLO** | [there](https://example.test/a) |");
  });
  test("keeps inline Markdown in a whole phrasing block", () => {
    const source = 'Open **Search** and press "**Saved**".';
    const segments = splitMarkdown(source).segments;
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe(source);
    const list = splitMarkdown("- Open **Search**\n\n| One | Two |\n| --- | --- |\n| Cell | Value |\n").segments;
    expect(list.map((segment) => segment.text)).toEqual(["Open **Search**", "One", "Two", "Cell", "Value"]);
  });
});
