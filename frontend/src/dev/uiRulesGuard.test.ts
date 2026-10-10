import { describe, expect, test } from "bun:test";
import { BASELINES, guardProblems, LEDGER, type Reader } from "./uiRulesGuard";

// PRECOMMIT-RULES-01: the staged-vs-HEAD guard refuses growth and lost reasons.
const ledger = (rows: string[]) => rows.map((id) => `| ${id} | a | b | c | d | e | active exception |`).join("\n");
const wrap = (entries: Record<string, { ed?: string; reason?: string }>) => JSON.stringify({ "shell/a.tsx": entries });
const oldWrap = (entries: Record<string, { ed?: string; reason?: string }>) => JSON.stringify({ [["next", "a.tsx"].join("/")]: entries });
const reader = (staged: Record<string, string>, head: Record<string, string>): Reader => (p, side) => (side === "staged" ? staged : head)[p] ?? null;

describe("ui-rules pre-commit guard", () => {
  const ok = { ed: "ED-001", reason: "kit lacks a variant" };
  const L = ledger(["ED-001"]);

  test("a clean staged tree passes", () => {
    const r = reader({ [BASELINES.wrapper]: wrap({ A: ok }), [LEDGER]: L }, { [BASELINES.wrapper]: oldWrap({ A: ok }), [LEDGER]: L });
    expect(guardProblems(r, [BASELINES.wrapper])).toEqual([]);
  });

  test("a baseline that grew is refused with the entry named", () => {
    const r = reader({ [BASELINES.wrapper]: wrap({ A: ok, NewPanel: ok }), [LEDGER]: L }, { [BASELINES.wrapper]: oldWrap({ A: ok }), [LEDGER]: L });
    const p = guardProblems(r, [BASELINES.wrapper]);
    expect(p.join("\n")).toContain("grew");
    expect(p.join("\n")).toContain("NewPanel");
  });

  test("a baseline entry with no ledger id, or an unknown one, is refused", () => {
    const r = reader({ [BASELINES.wrapper]: wrap({ A: { reason: "x" }, B: { ed: "ED-999", reason: "x" } }), [LEDGER]: L }, { [BASELINES.wrapper]: wrap({ A: { reason: "x" }, B: { ed: "ED-999", reason: "x" } }), [LEDGER]: L });
    const p = guardProblems(r, [BASELINES.wrapper]).join("\n");
    expect(p).toContain("has no ED id");
    expect(p).toContain("not a row");
  });

  test("an entry that loses its reason, or drops to NO-REASON-REMOVE, is refused", () => {
    const head = { [BASELINES.wrapper]: oldWrap({ A: ok, B: ok }), [LEDGER]: L };
    const r = reader({ [BASELINES.wrapper]: wrap({ A: { ed: "ED-001", reason: "" }, B: { ed: "NO-REASON-REMOVE", reason: "NO REASON: x" } }), [LEDGER]: L }, head);
    const p = guardProblems(r, [BASELINES.wrapper]).join("\n");
    expect(p).toContain("lost its reason");
    expect(p).toContain("downgraded");
  });

  // NEXT-RETIRE-02E-GUARD: the four Home slot renames carry through the merge-base comparison.
  const css = (entries: Record<string, { ed?: string; reason?: string }>) => JSON.stringify({ "shell/tokens.css": Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, { properties: ["position"], ...e }])) });
  const OLD = '[data-slot="next-chat-pane"] .x';
  const NEW = '[data-slot="chat-pane"] .x';

  test("a renamed slot key with the same entry passes", () => {
    const r = reader({ [BASELINES.css]: css({ [NEW]: ok }), [LEDGER]: L }, { [BASELINES.css]: css({ [OLD]: ok }), [LEDGER]: L });
    expect(guardProblems(r, [BASELINES.css])).toEqual([]);
  });

  test("a renamed slot key with a changed reason is refused", () => {
    const r = reader({ [BASELINES.css]: css({ [NEW]: { ed: "ED-001", reason: "something else" } }), [LEDGER]: L }, { [BASELINES.css]: css({ [OLD]: ok }), [LEDGER]: L });
    expect(guardProblems(r, [BASELINES.css]).join("\n")).toContain("changed while being renamed");
  });

  test("a brand-new chat-pane key with no old-name counterpart is refused", () => {
    const r = reader({ [BASELINES.css]: css({ [NEW]: ok }), [LEDGER]: L }, { [BASELINES.css]: css({}), [LEDGER]: L });
    expect(guardProblems(r, [BASELINES.css]).join("\n")).toContain("grew");
  });

  test("a deleted ledger row is refused", () => {
    const r = reader({ [LEDGER]: ledger(["ED-001"]) }, { [LEDGER]: ledger(["ED-001", "ED-002"]) });
    expect(guardProblems(r, [LEDGER]).join("\n")).toContain("ED-002");
  });
});
