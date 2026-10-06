import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classNameOverrideFindings,
  decisionProblem,
  ledgerCounts,
  ledgerRows,
  NO_REASON_ED,
  cssOverrideBaselineOf,
  cssOverrideFindings,
  type CssOverrideBaseline,
  forbiddenFamily,
  overrideBaselineOf,
  wrapperFindings,
  cssKeys,
  overrideKeys,
  wrapperKeys,
  type OverrideBaseline,
  type WrapperBaseline,
} from "./kitElementLints";

// ELEMENTS-LINT-02 and ELEMENTS-LINT-03 (RULES.md rule 9, "Kit Elements as
// they ship"). Same shape as ELEMENTS-LINT-01 (handBuiltChat.test.ts): a
// committed baseline of today's violations, a check that nothing new joins
// it, a check that fixed entries leave it, and a check that the baseline
// file itself never grows past origin/main's (the merge-base), so "just add the name" is no way
// past the gate.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const LEDGER_PATH = fileURLToPath(new URL("../../../docs/design/ELEMENTS-DECISIONS.md", import.meta.url));
const COUNTS_FILE = "elements-decisions-counts.json";
const OVERRIDE_BASELINE = "kit-classname-override-baseline.json";
const WRAPPER_BASELINE = "kit-wrapper-baseline.json";
const CSS_BASELINE = "kit-css-override-baseline.json";

const readBaseline = <T>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8")) as T;

/** The baseline as `origin/main` had it where this branch left it (the
 * merge-base the gate scopes by), falling back to HEAD, so an addition
 * committed before the gate runs still counts as growth. */
function baselineAtBase<T>(name: string): T | null {
  const git = (args: string[]) => execFileSync("git", args, { cwd: SRC, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let base = "HEAD";
  try {
    base = git(["merge-base", "HEAD", "origin/main"]) || "HEAD";
  } catch {
    // no origin/main (a fresh clone without the remote): HEAD stands in
  }
  try {
    const out = git(["show", `${base}:frontend/src/dev/${name}`]);
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

describe("className overrides on kit Elements (ELEMENTS-LINT-02)", () => {
  const baseline = readBaseline<OverrideBaseline>(OVERRIDE_BASELINE);

  test("no kit Element gets a shape, border, surface, spacing, size or layout class unless it is in the shrinking baseline", () => {
    const findings = classNameOverrideFindings(SRC);
    const added = findings.flatMap((f) => {
      const known = baseline[f.file]?.[f.element]?.tokens ?? [];
      const fresh = f.tokens.filter((t) => !known.includes(t));
      return fresh.length ? [`${f.file}:${f.line} <${f.element}> className="${fresh.join(" ")}" (${[...new Set(fresh.map((t) => forbiddenFamily(t)))].join(", ")})`] : [];
    });
    if (added.length) {
      throw new Error(
        `className override(s) on a kit Element, RULES.md rule 9:\n  ${added.join("\n  ")}\n` +
          `Use the Element as it ships: drop the class, restyle through tokens in commons ui/src/tokens.css, or use the ` +
          `Element's own props and variants. If the look is not reachable that way, add an additive prop or variant ` +
          `to the Element in commons first and pin the new tag; never override it from Home.`,
      );
    }
    const now = overrideKeys(overrideBaselineOf(findings));
    const stale = overrideKeys(baseline).filter((key) => !now.includes(key));
    expect(stale, `remove these from ${OVERRIDE_BASELINE} (the override is gone)`).toEqual([]);
  });

  test("the baseline never grows past the origin/main merge-base's", () => {
    const head = baselineAtBase<OverrideBaseline>(OVERRIDE_BASELINE);
    if (!head) return;
    const headKeys = overrideKeys(head);
    const grown = overrideKeys(baseline).filter((key) => !headKeys.includes(key));
    expect(grown, "the baseline may only shrink").toEqual([]);
  });

  test("the scanner flags a seeded override and leaves tokens, colors and placement alone", () => {
    const findings = classNameOverrideFindings(SRC, {
      "next/fixture.tsx": `
        import { CanvasSplit, CanvasSplitBody } from "@maipai/ui/src/elements/canvas-split";
        import { Button } from "@maipai/ui/src/ui/button";
        import { Card } from "@maipai/ui/src/dashboard/components/ui/card";
        import { cn } from "@maipai/ui/src/utils";
        const PANE = "md:h-full shadow-none";
        const look = { a: { className: "rounded-full" }, b: { className: "" } }["a"];
        export function Seeded({ wide, variant, props }: { wide: boolean; variant: string; props: { size: string } }) {
          return (
            <div className="rounded-xl border p-4">
              <CanvasSplit className="rounded-none border-0 border-l">
                <CanvasSplitBody className={cn("text-muted-foreground", wide && "px-6")} />
              </CanvasSplit>
              <CanvasSplit className={PANE} />
              <Button className="flex-1 self-end text-sm" />
              <Card className={\`bg-card \${wide ? "w-full" : ""}\`} />
              <Button className={cn(variant === "flex" && "text-sm", props.size)} />
              <Button className={look.className} />
            </div>
          );
        }
      `,
    });
    expect(findings.map((f) => [f.element, f.tokens])).toEqual([
      ["CanvasSplit", ["rounded-none", "border-0", "border-l"]],
      ["CanvasSplitBody", ["px-6"]],
      ["CanvasSplit", ["md:h-full", "shadow-none"]],
      ["Card", ["bg-card", "w-full"]],
      ["Button", ["rounded-full"]],
    ]);
  });

  test("each forbidden family is caught through variants and important marks", () => {
    for (const token of ["rounded", "md:rounded-lg", "border-x", "divide-y", "shadow-sm", "bg-background", "!p-0", "py-1", "-ms-2", "mx-auto", "w-80", "min-h-0", "size-7", "max-w-none", "flex", "flex-col", "grid", "gap-2", "items-center", "justify-start", "absolute", "before:-inset-3", "top-4", "[&_svg]:h-4"]) {
      expect(forbiddenFamily(token), token).toBeDefined();
    }
    for (const token of ["text-sm", "text-muted-foreground", "flex-1", "shrink-0", "self-end", "order-2", "col-span-2", "hidden", "md:block", "truncate", "font-medium"]) {
      expect(forbiddenFamily(token), token).toBeUndefined();
    }
  });
});

describe("Home CSS restyling kit parts (ELEMENTS-LINT-02, CSS leg)", () => {
  const baseline = readBaseline<CssOverrideBaseline>(CSS_BASELINE);
  const keys = cssKeys;

  test("no Home stylesheet sets shape, size, layout, spacing, border, shadow, background or display on a kit part unless it is in the shrinking baseline", () => {
    const findings = cssOverrideFindings(SRC);
    const added = findings.flatMap((f) => {
      const known = baseline[f.file]?.[f.selector]?.properties ?? [];
      const fresh = f.properties.filter((p) => !known.includes(p));
      return fresh.length ? [`${f.file}:${f.line} ${f.selector} { ${fresh.join("; ")} } (kit part ${f.part})`] : [];
    });
    if (added.length) {
      throw new Error(
        `Home CSS restyles a kit part, RULES.md rule 9:\n  ${added.join("\n  ")}\n` +
          `Home CSS may only define design tokens (CSS custom properties) the kit itself reads. If the look needs more, ` +
          `add an additive variant or prop to the Element in commons (for example a compact composer variant), pin the ` +
          `new tag and select it from Home; never restyle the kit's data-slot, aui-* or kit classes from Home CSS.`,
      );
    }
    const now = keys(cssOverrideBaselineOf(findings));
    const stale = keys(baseline).filter((key) => !now.includes(key));
    expect(stale, `remove these from ${CSS_BASELINE} (the rule is gone)`).toEqual([]);
  });

  test("the baseline never grows past the origin/main merge-base's", () => {
    const head = baselineAtBase<CssOverrideBaseline>(CSS_BASELINE);
    if (!head) return;
    const headKeys = keys(head);
    const grown = keys(baseline).filter((key) => !headKeys.includes(key));
    expect(grown, "the baseline may only shrink").toEqual([]);
  });

  test("the scanner flags a seeded kit restyle and leaves tokens and Home's own slots alone", () => {
    const findings = cssOverrideFindings(
      SRC,
      {
        "shell/seeded.css": `
          /* a comment { with braces } */
          [data-slot="home-pane"] [data-slot="aui_composer-shell"] { display: grid; border-radius: 28px; --composer-gap: 4px; color: red; }
          @media (pointer: coarse) {
            [data-slot="home-pane"] .aui-composer-send::before { position: absolute; inset: -10px; content: ""; }
          }
          [data-slot="home-pane"] { display: flex; padding: 8px; }
          .aui-shiki-base { color-scheme: dark; }
          :root { --composer-height: 48px; }
          @keyframes pulse { from { width: 0; } to { width: 10px; } }
        `,
      },
      new Set(["home-pane"]),
    );
    expect(findings.map((f) => [f.part, f.properties])).toEqual([
      ['[data-slot="aui_composer-shell"]', ["display", "border-radius"]],
      [".aui-composer-send", ["position", "inset"]],
    ]);
  });
});

describe("Home wrappers around kit Elements (ELEMENTS-LINT-03)", () => {
  const baseline = readBaseline<WrapperBaseline>(WRAPPER_BASELINE);

  test("no Home component wraps, frames or re-skins a kit Element unless it is in the shrinking allowlist", () => {
    const findings = wrapperFindings(SRC);
    const added = findings.filter((f) => !(f.component in (baseline[f.file] ?? {}))).map((f) => `${f.file}:${f.line} ${f.component} (${f.why})`);
    if (added.length) {
      throw new Error(
        `New wrapper component(s) around a kit Element, RULES.md rule 9:\n  ${added.join("\n  ")}\n` +
          `Render the Element directly where it is used and pass it data, handlers and copy. A box, row or overlay ` +
          `the Element lacks is a kit change (an additive prop, slot or variant in commons), never a Home component. ` +
          `The allowlist in ${WRAPPER_BASELINE} only shrinks.`,
      );
    }
    const now = new Set(findings.map((f) => `${f.file}: ${f.component}`));
    const stale = wrapperKeys(baseline).filter((key) => !now.has(key));
    expect(stale, `remove these from ${WRAPPER_BASELINE} (no longer a wrapper)`).toEqual([]);
  });

  test("every allowlist entry carries a reason", () => {
    const missing = Object.entries(baseline).flatMap(([file, byName]) => Object.entries(byName).filter(([, entry]) => !entry.reason?.trim()).map(([name]) => `${file}: ${name}`));
    expect(missing).toEqual([]);
  });

  test("the allowlist never grows past the origin/main merge-base's", () => {
    const head = baselineAtBase<WrapperBaseline>(WRAPPER_BASELINE);
    if (!head) return;
    const headKeys = wrapperKeys(head);
    const grown = wrapperKeys(baseline).filter((key) => !headKeys.includes(key));
    expect(grown, "the allowlist may only shrink").toEqual([]);
  });

  test("the scanner flags seeded wrappers and leaves a page that only passes data alone", () => {
    const findings = wrapperFindings(SRC, {
      "next/pages/SeededPanel.tsx": `
        import { CanvasSplit } from "@maipai/ui/src/elements/canvas-split";
        import { CommandPalette } from "@maipai/ui/src/elements/command-palette";
        import { Card } from "@maipai/ui/src/dashboard/components/ui/card";
        import { Page } from "@maipai/ui/src/primitives/Page";
        function ArtifactPane({ id }: { id: string }) { return <CanvasSplit key={id} />; }
        const Framed = () => (<div className="fixed inset-0"><CommandPalette commands={[]} /></div>);
        export function Overlay({ open }: { open: boolean }) {
          return <>{open && <div role="dialog"><CommandPalette commands={[]} /></div>}</>;
        }
        function SummaryCard() { return <section><p>hi</p></section>; }
        function Outer() { const InnerPane = () => <CanvasSplit />; return <section><InnerPane /></section>; }
        export function SeededPanel() { return <Page title="Seeded"><Card /></Page>; }
      `,
      "next/pages/SeededPage.tsx": `
        import { Card } from "@maipai/ui/src/dashboard/components/ui/card";
        import { Page } from "@maipai/ui/src/primitives/Page";
        export function SeededPage() { return <Page title="Seeded"><Card /></Page>; }
      `,
    });
    expect(findings.map((f) => [f.component, f.why])).toEqual([
      ["ArtifactPane", "returns <CanvasSplit> as its root"],
      ["Framed", "draws its own <div> box around <CommandPalette>"],
      ["Overlay", "draws its own <div> box around <CommandPalette>"],
      ["SummaryCard", "named like a wrapper in a file that imports a kit Element"],
      ["InnerPane", "returns <CanvasSplit> as its root"],
      ["SeededPanel", "named like a wrapper in a file that imports a kit Element"],
    ]);
  });
});

describe("registered renders are the Element's use site (RULES.md rule 9(b) exception)", () => {
  const REGISTRY = `
    import { PlainRender, BoxedRender, ClassRender } from "@/apps/chat/seededRenders";
    export const TOOL_BINDINGS = [
      { toolName: "a", element: "x", render: PlainRender },
      { toolName: "b", element: "x", render: BoxedRender },
      { toolName: "c", element: "x", render: ClassRender },
    ];
    export const DATA_BINDINGS = [{ name: "d", element: "x", render: (p: unknown) => <Thing {...p} /> }];
  `;
  const RENDERS = `
    import { Gallery } from "@maipai/ui/src/elements/image-gallery";
    export function PlainRender({ result }: { result?: { images: string[] } }) {
      if (!result) return null;
      return <Gallery images={result.images} />;
    }
    export function BoxedRender({ result }: { result?: { images: string[] } }) {
      return <div><Gallery images={result?.images ?? []} /></div>;
    }
    export function ClassRender({ result }: { result?: { images: string[] } }) {
      return <Gallery className="p-4" images={result?.images ?? []} />;
    }
    export function NotRegistered() { return <Gallery images={[]} />; }
  `;

  test("a registered render that returns only the Element passes; a box, a className, an unregistered one and an inline arrow are flagged", () => {
    const findings = wrapperFindings(SRC, { "apps/chat/elementBindings.ts": REGISTRY, "apps/chat/seededRenders.tsx": RENDERS });
    expect(findings.map((f) => [f.component, f.why])).toEqual([
      ["BoxedRender", "draws its own <div> box around <Gallery>"],
      ["ClassRender", "returns <Gallery> as its root"],
      ["NotRegistered", "returns <Gallery> as its root"],
      ["inline render for \"d\"" , "an inline function registered as a render; register a named function that returns only the Element"],
    ]);
  });
});

describe("Elements decisions ledger (ELEMENTS-DECISIONS-01)", () => {
  const ledger = ledgerRows(readFileSync(LEDGER_PATH, "utf8"));
  const entries = (): [string, unknown][] => [
    ...Object.entries(readBaseline<OverrideBaseline>(OVERRIDE_BASELINE)).flatMap(([f, d]) => Object.entries(d).map(([k, e]) => [`${OVERRIDE_BASELINE} ${f}: <${k}>`, e] as [string, unknown])),
    ...Object.entries(readBaseline<CssOverrideBaseline>(CSS_BASELINE)).flatMap(([f, d]) => Object.entries(d).map(([k, e]) => [`${CSS_BASELINE} ${f}: ${k}`, e] as [string, unknown])),
    ...Object.entries(readBaseline<WrapperBaseline>(WRAPPER_BASELINE)).flatMap(([f, d]) => Object.entries(d).map(([k, e]) => [`${WRAPPER_BASELINE} ${f}: ${k}`, e] as [string, unknown])),
  ];

  test("the ledger has rows, each with a valid status", () => {
    expect(ledger.size).toBeGreaterThan(30);
  });

  test("every baseline entry carries a reason and an ED id that is a ledger row or NO-REASON-REMOVE", () => {
    const bad = entries().flatMap(([where, entry]) => {
      const problem = decisionProblem(entry, ledger);
      return problem ? [`${where} ${problem}`] : [];
    });
    expect(bad, "add the entry's decision to docs/design/ELEMENTS-DECISIONS.md and cite its ED id").toEqual([]);
  });

  test("a ledger row marked removed has no baseline entry", () => {
    const removed = new Set([...ledger].filter(([, status]) => status === "removed").map(([id]) => id));
    const stillThere = entries().filter(([, e]) => removed.has((e as { ed?: string }).ed ?? "")).map(([where]) => where);
    expect(stillThere).toEqual([]);
  });

  test("the panel's counts file equals the ledger", () => {
    const counts = readBaseline<{ active: number; beingRemoved: number; removed: number }>(COUNTS_FILE);
    expect(counts).toEqual(ledgerCounts(ledger));
  });

  test("seeded violations are refused: no reason, no id, unknown id, removed row, bad NO-REASON-REMOVE", () => {
    const rows = ledgerRows([
      "| ED-001 | a | b | c | d | e | active exception |",
      "| ED-002 | a | b | c | d | e | being removed |",
      "| ED-003 | a | b | c | d | e | removed |",
    ].join("\n"));
    expect(decisionProblem({ ed: "ED-001", reason: "kit lacks a variant" }, rows)).toBeUndefined();
    expect(decisionProblem({ ed: "ED-002", reason: "NO REASON: to be removed" }, rows)).toBeUndefined();
    expect(decisionProblem({ ed: NO_REASON_ED, reason: "NO REASON: to be removed" }, rows)).toBeUndefined();
    expect(decisionProblem({ ed: "ED-001", reason: "" }, rows)).toBe("has no reason");
    expect(decisionProblem({ ed: "ED-001", reason: "   " }, rows)).toBe("has no reason");
    expect(decisionProblem({ reason: "x" }, rows)).toBe("has no ED id");
    expect(decisionProblem({ ed: "", reason: "x" }, rows)).toBe("has no ED id");
    expect(decisionProblem("a bare string", rows)).toBe("has no reason");
    expect(decisionProblem({ ed: "ED-999", reason: "x" }, rows)).toContain("not a row");
    expect(decisionProblem({ ed: "ED-003", reason: "x" }, rows)).toContain("marks removed");
    expect(decisionProblem({ ed: NO_REASON_ED, reason: "because" }, rows)).toContain("NO REASON");
  });

  test("the ledger parser counts statuses and rejects a bad status or a repeated id", () => {
    const rows = ledgerRows("| ED-001 | a | b | c | d | e | active exception |\n| ED-002 | a | b | c | d | e | removed |\n| not a row | x |");
    expect(ledgerCounts(rows)).toEqual({ active: 1, beingRemoved: 0, removed: 1 });
    expect(() => ledgerRows("| ED-001 | a | b | c | d | e | maybe |")).toThrow("status must be one of");
    expect(() => ledgerRows("| ED-001 | a | b | active exception")).toThrow("must end");
    expect(() => ledgerRows("| ED-001 | a | b | |")).toThrow("status must be one of");
    expect(() => ledgerRows("| ED-001 | a | active exception |\n| ED-001 | a | removed |")).toThrow("twice");
  });
});
