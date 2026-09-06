// A lint fixture (docs/plans/session-b-ui.md step 1): every custom rule
// this session's `eslint.config.js` adds gets a real snippet proving it
// fires, and a compliant equivalent proving it doesn't fire on innocent
// code. Config drift (a rule silently disabled, a glob narrowed until it
// matches nothing) shows up here as a real test failure instead of a
// lint that quietly stops running.
import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: import.meta.dir + "/.." });

async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? "");
}

describe("eslint.config.js", () => {
  test("bans importing lucide-react outside kit/icons.ts", async () => {
    const ids = await ruleIdsFor(
      'import { Check } from "lucide-react";\nexport const X = Check;\n',
      "src/apps/fixture.tsx",
    );
    expect(ids).toContain("no-restricted-imports");
  });

  test("allows lucide-react inside kit/icons.ts", async () => {
    const ids = await ruleIdsFor(
      'import { Check } from "lucide-react";\nexport const X = Check;\n',
      "src/kit/icons.ts",
    );
    expect(ids).not.toContain("no-restricted-imports");
  });

  test("bans a raw <button> in src/apps", async () => {
    const ids = await ruleIdsFor("export const X = () => <button>Go</button>;\n", "src/apps/fixture.tsx");
    expect(ids).toContain("no-restricted-syntax");
  });

  test("bans a raw <input> in src/apps", async () => {
    const ids = await ruleIdsFor("export const X = () => <input />;\n", "src/apps/fixture.tsx");
    expect(ids).toContain("no-restricted-syntax");
  });

  test("allows the kit's own Button in src/kit/primitives", async () => {
    const ids = await ruleIdsFor("export const X = () => <button>Go</button>;\n", "src/kit/primitives/fixture.tsx");
    expect(ids).not.toContain("no-restricted-syntax");
  });

  test("bans a raw hex color in an arbitrary Tailwind value", async () => {
    const ids = await ruleIdsFor('export const X = () => <div className="bg-[#ff0000]" />;\n', "src/apps/fixture.tsx");
    expect(ids).toContain("better-tailwindcss/no-restricted-classes");
  });

  test("bans a raw rgb() literal in an arbitrary Tailwind value", async () => {
    const ids = await ruleIdsFor(
      'export const X = () => <div className="bg-[rgb(255,0,0)]" />;\n',
      "src/apps/fixture.tsx",
    );
    expect(ids).toContain("better-tailwindcss/no-restricted-classes");
  });

  test("allows a token reference in an arbitrary Tailwind value", async () => {
    const ids = await ruleIdsFor(
      'export const X = () => <div className="bg-[var(--primary)]" />;\n',
      "src/apps/fixture.tsx",
    );
    expect(ids).not.toContain("better-tailwindcss/no-restricted-classes");
  });

  test("bans a hover: variant with no focus equivalent on a native element", async () => {
    const ids = await ruleIdsFor(
      'export const X = () => <div className="hover:bg-muted" />;\n',
      "src/apps/fixture.tsx",
    );
    expect(ids).toContain("local/hover-needs-focus");
  });

  test("allows a hover: variant paired with a focus variant", async () => {
    const ids = await ruleIdsFor(
      'export const X = () => <div className="hover:bg-muted focus-visible:bg-muted" />;\n',
      "src/apps/fixture.tsx",
    );
    expect(ids).not.toContain("local/hover-needs-focus");
  });

  test("does not flag hover: passed as a className prop to a kit component", async () => {
    const ids = await ruleIdsFor(
      'export const X = () => <Button className="hover:bg-muted" />;\n',
      "src/apps/fixture.tsx",
    );
    expect(ids).not.toContain("local/hover-needs-focus");
  });
});
