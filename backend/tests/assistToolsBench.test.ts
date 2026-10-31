// ASSIST-BENCH-01: the dataset's shape, the scoring on fabricated model outputs, and the interval helper.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alarmFoldFor } from "@/lib/alarmCalls";
import { ACTIONS_BY_TOOL, ALARM_ACTIONS, EXISTING_FOLDS, REMINDER_ACTIONS } from "../scripts/bench/assistActions";
import {
  BAR, buildReport, judgeBar, judgeRegression, pairedOnOff, rowRates, scoreRow, summarize,
  type ArmRun, type AssistRow, type Observed, type RunScore,
} from "../scripts/bench/assistToolsScore";

const raw = readFileSync(join(import.meta.dir, "..", "scripts", "bench", "datasets", "assist-tools.json"), "utf-8");
const rows = (JSON.parse(raw) as { rows: AssistRow[] }).rows;
const ROSTER = (
  "alfred astro atlas bramble bruno clover cosmo daisy ember indigo iris juniper lucia marlow marsh mopey nadia nova oliver " +
  "pippa quill raven riff rivet rover sage serena sprout tempo velvet vincent willow"
).split(" ");

describe("assist-tools dataset", () => {
  const count = (pick: (r: AssistRow) => boolean) => rows.filter(pick).length;
  test("about 120 rows, with 20 negatives and about 30 to 40 per area", () => {
    expect(rows.length).toBe(120);
    expect(count((r) => r.kind === "negative")).toBe(20);
    expect(count((r) => r.area === "negatives")).toBe(20);
    for (const area of ["lists", "reminders", "alarms"]) expect(count((r) => r.area === area)).toBeGreaterThanOrEqual(30);
  });
  test("ids are unique and every row has the required fields", () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.utterance.trim().length).toBeGreaterThan(3);
      expect(["positive", "negative", "clarify"]).toContain(r.kind);
      expect(["dev", "heldout"]).toContain(r.split);
      expect(typeof r.keyArgs).toBe("object");
    }
  });
  test("the split is half and half overall and within each area", () => {
    expect(count((r) => r.split === "dev")).toBe(60);
    expect(count((r) => r.split === "heldout")).toBe(60);
    for (const area of ["lists", "reminders", "alarms", "negatives"]) {
      expect(count((r) => r.area === area && r.split === "dev")).toBe(count((r) => r.area === area && r.split === "heldout"));
    }
  });
  test("expected tools and actions exist in the action lists", () => {
    for (const r of rows) {
      if (r.kind === "negative") {
        expect(r.tool).toBe("none");
        expect(r.action).toBe("none");
        continue;
      }
      expect(["remind", "timer"]).toContain(r.tool);
      expect(ACTIONS_BY_TOOL[r.tool as "remind" | "timer"]).toContain(r.action);
    }
  });
  test("area decides the tool: lists and reminders use remind, alarms use timer", () => {
    for (const r of rows.filter((x) => x.kind !== "negative")) expect(r.tool).toBe(r.area === "alarms" ? "timer" : "remind");
  });
  test("every action of each area is exercised, and on both splits where it has two rows", () => {
    const wanted = [...ACTIONS_BY_TOOL.remind, ...ACTIONS_BY_TOOL.timer];
    for (const action of wanted) {
      const mine = rows.filter((r) => r.action === action);
      expect(mine.length).toBeGreaterThan(0);
      if (mine.length >= 2) expect(new Set(mine.map((r) => r.split)).size).toBe(2);
    }
  });
  test("the action names that exist in alarmCalls.ts agree with the bench lists", () => {
    for (const [tool, actions] of Object.entries(EXISTING_FOLDS)) for (const action of actions) expect(alarmFoldFor(tool, action)).not.toBeNull();
    for (const action of [...REMINDER_ACTIONS, ...ALARM_ACTIONS]) expect(typeof action).toBe("string");
  });
  test("context rows carry prior turns, and there are some", () => {
    const withContext = rows.filter((r) => r.context);
    expect(withContext.length).toBeGreaterThanOrEqual(5);
    for (const r of withContext) for (const turn of r.context!) expect(turn.user && turn.assistant).toBeTruthy();
  });
  test("no em dashes, no addresses, and only roster names as mid-sentence proper nouns", () => {
    expect(raw.includes("\u2014")).toBe(false);
    expect(/@|https?:|\d{3}[- ]\d{4}/.test(raw)).toBe(false);
    const texts = rows.flatMap((r) => [r.utterance, ...(r.context ?? []).flatMap((c) => [c.user, c.assistant])]);
    const allowed = new Set([...ROSTER, "costco", "weekend", "pantry", "backup", "monday", "wednesday", "friday", "friday", "saturday", "sunday", "thursday", "lisbon"]);
    for (const text of texts) {
      for (const match of text.matchAll(/(?<=[a-z,] )[A-Z][a-z]+/g)) expect(allowed.has(match[0].toLowerCase().replace(/s$/, ""))).toBe(true);
    }
  });
});

const row = (over: Partial<AssistRow>): AssistRow => ({
  id: "x", area: "lists", kind: "positive", utterance: "u", tool: "remind", action: "add_items",
  keyArgs: { list: ["groceries"], items: ["oat milk"] }, split: "dev", ...over,
});
const call = (tool: string, args: Record<string, unknown>): Observed => ({ calls: [{ tool, args }], reply: "Done." });

describe("scoreRow", () => {
  test("right tool, right action, key words present", () => {
    const s = scoreRow(row({}), call("remind", { action: "add_items", list: "groceries", items: ["Oat Milk"] }));
    expect(s).toMatchObject({ toolOk: true, actionOk: true, argsOk: true, pass: true });
  });
  test("wrong tool fails tool and action", () => {
    const s = scoreRow(row({}), call("timer", { action: "add_items", expression: "groceries oat milk" }));
    expect(s).toMatchObject({ toolOk: false, actionOk: false, pass: false });
  });
  test("wrong action keeps the tool right but fails", () => {
    const s = scoreRow(row({}), call("remind", { action: "remove_items", list: "groceries", items: ["oat milk"] }));
    expect(s).toMatchObject({ toolOk: true, actionOk: false, pass: false });
  });
  test("missing key words fail the arguments but not the headline", () => {
    const s = scoreRow(row({}), call("remind", { action: "add_items", list: "groceries" }));
    expect(s).toMatchObject({ toolOk: true, actionOk: true, argsOk: false, pass: true });
  });
  test("no action means a plain reminder on remind, and a plain timer on timer", () => {
    expect(scoreRow(row({ area: "reminders", action: "create_reminder", keyArgs: {} }), call("remind", { expression: "at 4 casserole" })).pass).toBe(true);
    expect(scoreRow(row({ area: "alarms", tool: "timer", action: "set_alarm", keyArgs: {} }), call("timer", { expression: "6:30" })).actionOk).toBe(false);
  });
  test("no call at all fails a positive", () => {
    expect(scoreRow(row({}), { calls: [], reply: "Sure." })).toMatchObject({ called: false, toolOk: false, pass: false });
  });
  test("a call on a negative fails; no call passes; another tool does not count against it", () => {
    const neg = row({ kind: "negative", tool: "none", action: "none", keyArgs: {} });
    expect(scoreRow(neg, call("remind", { expression: "milk" })).pass).toBe(false);
    expect(scoreRow(neg, { calls: [], reply: "Tacos need tortillas." }).pass).toBe(true);
    expect(scoreRow(neg, call("websearch", { expression: "alarm clock" })).pass).toBe(true);
  });
  test("a clarify row passes only with no call and a question", () => {
    const clarify = row({ kind: "clarify" });
    expect(scoreRow(clarify, { calls: [], reply: "Which one, Costco or Weekend?" }).pass).toBe(true);
    expect(scoreRow(clarify, { calls: [], reply: "Okay." }).pass).toBe(false);
    expect(scoreRow(clarify, { calls: [{ tool: "remind", args: { action: "add_items" } }], reply: "Which one?" }).pass).toBe(false);
  });
  test("an errored run never passes", () => {
    expect(scoreRow(row({ kind: "negative", tool: "none", action: "none" }), { calls: [], reply: "", error: "HTTP 503" }).pass).toBe(false);
  });
});

const runOf = (rowId: string, pass: boolean, rep = 1): RunScore => ({
  rowId, rep,
  score: { called: true, toolOk: pass, actionOk: pass, argsOk: pass, noCall: false, clarifyOk: false, pass, errored: false },
});
const summaryOf = (tool: number | null, neg: number | null, posRuns = 20, negRuns = 20) => ({
  positives: { runs: posRuns, toolRate: tool, actionRate: tool, toolAndActionRate: tool, argsRate: tool },
  negatives: { runs: negRuns, noCallRate: neg },
  clarify: { runs: 0, clarifyRate: null },
});

describe("summaries, interval and bar", () => {
  test("rowRates averages repeats per row", () => {
    const rates = rowRates([runOf("a", true, 1), runOf("a", false, 2), runOf("b", true, 1)]);
    expect(rates.get("a")).toBe(0.5);
    expect(rates.get("b")).toBe(1);
  });
  test("paired interval on fixed numbers", () => {
    const on = Array.from({ length: 10 }, (_, i) => runOf(`r${i}`, true));
    const off = Array.from({ length: 10 }, (_, i) => runOf(`r${i}`, i < 4));
    // Differences: six rows at +1, four at 0. Mean 0.6, sample variance 0.2667, half = 1.96 * sqrt(0.02667) = 0.3201.
    expect(pairedOnOff(on, off)).toEqual({ n: 10, meanDiffPct: 60, lowPct: 28, highPct: 92 });
    expect(pairedOnOff(on.slice(0, 1), off.slice(0, 1))).toBeNull();
  });
  test("an identical pair gives a zero interval", () => {
    const same = Array.from({ length: 5 }, (_, i) => runOf(`r${i}`, i % 2 === 0));
    expect(pairedOnOff(same, same)).toEqual({ n: 5, meanDiffPct: 0, lowPct: 0, highPct: 0 });
  });
  test("summarize splits positives, negatives and clarify rows", () => {
    const set = [row({ id: "p" }), row({ id: "n", kind: "negative", tool: "none", action: "none" }), row({ id: "c", kind: "clarify" })];
    const s = summarize(set, [runOf("p", true), runOf("p", false, 2), runOf("n", true), runOf("c", false)]);
    expect(s.positives).toMatchObject({ runs: 2, toolAndActionRate: 0.5 });
    expect(s.negatives).toMatchObject({ runs: 1, noCallRate: 1 });
    expect(s.clarify).toMatchObject({ runs: 1, clarifyRate: 0 });
  });
  test("the bar passes at 95% and 95%, fails under, and an empty set fails", () => {
    expect(judgeBar(summaryOf(BAR.toolAndAction, BAR.negativesNoCall)).pass).toBe(true);
    expect(judgeBar(summaryOf(0.94, 1)).pass).toBe(false);
    expect(judgeBar(summaryOf(1, 0.9)).pass).toBe(false);
    expect(judgeBar(summaryOf(null, null, 0, 0)).pass).toBe(false);
  });
  test("regression: a drop under the floor fails, no change passes", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const off = new Map(ids.map((id) => [id, 1]));
    const worse = new Map(ids.map((id, i) => [id, i < 6 ? 0 : 1]));
    expect(judgeRegression("x", worse, off).pass).toBe(false);
    expect(judgeRegression("x", off, off).pass).toBe(true);
    expect(judgeRegression("x", new Map(), new Map()).pass).toBe(false);
  });
  test("buildReport judges the bar on the held-out rows of the on arm only", () => {
    const set = [row({ id: "d", split: "dev" }), row({ id: "h", split: "heldout" })];
    const arm = (a: "on" | "off", id: string, pass: boolean): ArmRun => ({ ...runOf(id, pass), arm: a, calls: [], reply: "", error: null });
    const report = buildReport(set, [arm("on", "d", false), arm("on", "h", true), arm("off", "d", true), arm("off", "h", false)]);
    expect(report.bar.pass).toBe(false); // negatives have no runs
    expect(report.heldoutOn.positives.toolAndActionRate).toBe(1);
    expect(report.heldoutOff.positives.toolAndActionRate).toBe(0);
  });
});
