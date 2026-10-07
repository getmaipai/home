import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chatSourceFiles, elementsReplacing, handBuiltChatComponents, wireNowElements, type HandBuiltBaseline } from "./handBuiltChat";

// ELEMENTS-LINT-01 (RULES.md rule 9): the list of chat components that draw
// their own markup may only shrink. Mirrors backend/scripts/lint/rule-budget.ts:
// a committed baseline, and a check that the baseline itself never grows past
// what HEAD has, so "just add the name" is not a way past the gate.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = fileURLToPath(new URL("./hand-built-chat-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as HandBuiltBaseline;

function baselineAtHead(): HandBuiltBaseline | null {
  try {
    const out = execFileSync("git", ["show", "HEAD:frontend/src/dev/hand-built-chat-baseline.json"], { cwd: SRC, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const baseline = JSON.parse(out) as HandBuiltBaseline;
    return Object.fromEntries(Object.entries(baseline).map(([file, names]) => [
      file.replace(/(^|\/)next\//g, "$1shell/").replace(/(^|\/)Next([A-Z])/g, "$1$2"),
      names.map((name) => name.replace(/^Next([A-Z])/, "$1")),
    ])) as HandBuiltBaseline;
  } catch {
    return null;
  }
}

const count = (b: HandBuiltBaseline) => Object.values(b).reduce((sum, names) => sum + names.length, 0);

describe("hand-built chat components (ELEMENTS-LINT-01)", () => {
  test("generic kit Elements do not classify non-chat pages as chat source", () => {
    const files = chatSourceFiles(SRC);
    expect(files).not.toContain("shell/pages/DashboardPage.tsx");
    expect(files).not.toContain("shell/pages/StatusPage.tsx");
  });

  test("no chat component draws its own markup unless it is in the shrinking baseline", () => {
    const found = handBuiltChatComponents(SRC);
    const added = Object.entries(found).flatMap(([file, names]) =>
      names.filter((name) => !(baseline[file] ?? []).includes(name)).map((name) => {
        const elements = elementsReplacing(SRC, file);
        return `${file}: ${name}${elements.length ? ` (the plan's Element for this file: ${elements.join(", ")})` : ""}`;
      }));
    if (added.length) {
      throw new Error(
        `New hand-built chat component(s), RULES.md rule 9:\n  ${added.join("\n  ")}\n` +
          `Look the job up in frontend/src/dev/elements-adoption.json and wire the kit Element instead ` +
          `(wire-now Elements not yet in use: ${wireNowElements(SRC).join(", ")}). A real gap is named in RULES.md rule 9 first.`,
      );
    }
    // A removed component must leave the baseline too, so the count only goes down.
    const stale = Object.entries(baseline).flatMap(([file, names]) => names.filter((name) => !(found[file] ?? []).includes(name)).map((name) => `${file}: ${name}`));
    expect(stale, "remove these from hand-built-chat-baseline.json (they no longer draw markup)").toEqual([]);
  });

  test("the baseline never grows past HEAD's", () => {
    const head = baselineAtHead();
    if (!head) return;
    const grown = Object.entries(baseline).flatMap(([file, names]) => names.filter((name) => !(head[file] ?? []).includes(name)).map((name) => `${file}: ${name}`));
    expect(grown, "the baseline may only shrink").toEqual([]);
    expect(count(baseline)).toBeLessThanOrEqual(count(head));
  });

  test("the scanner flags a component that renders a DOM tag and not one that only composes", () => {
    const flagged = handBuiltChatComponents(SRC, {
      "apps/chat/fixture.tsx": `
        export function Drawn() { return <div className="x">hi</div>; }
        export const AlsoDrawn = () => <span>hi</span>;
        export function Composed() { return <Thread components={{}} />; }
        const lower = () => <p>not a component</p>;
        const SCREAMING_CONSTANT = <p>a constant, not a component</p>;
      `,
    });
    expect(flagged["apps/chat/fixture.tsx"]).toEqual(["Drawn", "AlsoDrawn"]);
  });
});
