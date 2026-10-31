import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { colorFindings } from "./colorLints";

const SRC = fileURLToPath(new URL("..", import.meta.url));

describe("theme color lint", () => {
  test("flags CSS colors, named colors, palette utilities and arbitrary colors", () => {
    const findings = colorFindings(SRC, {
      "fixture.tsx": `const styles = "bg-blue-500 text-[#123456]";\nconst color = "navy";\nconst css = "color: rgb(1, 2, 3)";`,
    });
    expect(findings.map(({ line, pattern }) => [line, pattern])).toEqual([
      [1, "bg-blue-500"], [1, "text-[#123456]"], [3, "rgb("],
    ]);
  });

  test("passes theme tokens, ordinary prose and documented camera exceptions", () => {
    const findings = colorFindings(SRC, {
      "shell/fixture.css": `color: var(--foreground); /* white */\n/* #123456 */\nbackground: color-mix(in srgb, var(--background), transparent);`,
      "apps/people/FaceEnrollmentPage.tsx": `const preview = "bg-black";\nconst scrim = "bg-black/60";`,
    });
    expect(findings).toEqual([]);
  });

  test("flags arbitrary token utility classes", () => {
    const findings = colorFindings(SRC, {
      "fixture.tsx": `const styles = "text-[var(--muted-foreground)] border-[var(--border)]";`,
    });
    expect(findings.map(({ pattern }) => pattern)).toEqual(["text-[var(--muted-foreground)]", "border-[var(--border)]"]);
  });

  test("frontend source contains no undocumented fixed colors", () => {
    expect(colorFindings(SRC)).toEqual([]);
  });
});
