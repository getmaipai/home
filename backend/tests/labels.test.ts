// RVW-1: the label export over seeded turn rows, the roster form, the
// credential skip and the weekly report's zero-hit rules.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREDENTIAL_REDACTION } from "@/lib/memoryContentPolicy";
import { toRosterForm, weekKey, labelOf, exportLabels, weeklyReport, formatReport, knownRules, type LabelRow } from "../scripts/bench/labels";

const signal = (act: string, source = "rule", stance = "asserted") => JSON.stringify({ primary_act: act, expressed_emotion: "neutral", emotion_intensity: "none", source, clauses: [{ stance }] });

const row = (partial: Partial<LabelRow> & Pick<LabelRow, "id" | "userText">): LabelRow => ({
  createdAt: "2026-09-16T12:00:00.000Z",
  source: "model",
  signal: signal("inform"),
  rung: "none",
  guardReason: null,
  rules: JSON.stringify(["signal.rule"]),
  outcomes: null,
  correctedNextTurn: null,
  ...partial,
});

describe("the roster form", () => {
  test("every household name becomes a roster name by position, whole words, any case, the longest name first", () => {
    const names = ["Jo", "Jo Pickles", "Biscuit"];
    expect(toRosterForm("Jo said Biscuit chewed jo's shoe; Jo Pickles laughed", names)).toBe("Alfred said Atlas chewed Alfred's shoe; Astro laughed");
    expect(toRosterForm("nothing to redact", names)).toBe("nothing to redact");
    expect(toRosterForm("Josephine is not Jo", ["Jo"])).toBe("Josephine is not Alfred");
  });

  test("the ISO week key", () => {
    expect(weekKey("2026-09-16T12:00:00.000Z")).toBe("2026-W38");
    expect(weekKey("2026-01-01T00:00:00.000Z")).toBe("2026-W01");
    expect(weekKey("2027-01-03T00:00:00.000Z")).toBe("2026-W53");
  });
});

describe("the export", () => {
  test("writes one line per turn with the text in roster form, skips a credential turn, and the report names a rule with zero hits", () => {
    const dir = mkdtempSync(join(tmpdir(), "maipai-labels-"));
    try {
      const rows: LabelRow[] = [
        row({ id: "t1", userText: "when is the new album out", source: "plugin", signal: signal("question"), rung: "search", rules: JSON.stringify(["signal.rule", "lookup.read.promise", "lookup.forced"]), outcomes: JSON.stringify([{ packageId: "websearch", status: "succeeded", via: "forced" }]), correctedNextTurn: 1 }),
        row({ id: "t2", userText: "you're not listening, Jo asked what time", signal: signal("inform", "rule", "asserted"), rules: JSON.stringify(["signal.rule", "guard.repeat_reply"]), guardReason: "repeat_reply" }),
        row({ id: "t3", userText: `my wifi password is ${CREDENTIAL_REDACTION}`, source: "policy", rules: JSON.stringify(["credential"]) }),
        row({ id: "t4", userText: "Biscuit is asleep", createdAt: "2026-09-21T12:00:00.000Z", signal: signal("inform", "protocol") }),
      ];
      const labels = rows.map((r) => labelOf(r, ["Jo", "Biscuit"])).filter((l) => l !== null);
      expect(labels.map((l) => l!.turn_id)).toEqual(["t1", "t2", "t4"]);
      const reports = exportLabels(labels as NonNullable<(typeof labels)[number]>[], dir);
      expect(reports.map((r) => r.week)).toEqual(["2026-W38", "2026-W39"]);
      const lines = readFileSync(join(dir, "2026-W38.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatchObject({ turn_id: "t1", rung: "search", forced_lookup: true, corrected_next_turn: true, signal: { act: "question", stance: "asserted", source: "rule" }, rules: ["signal.rule", "lookup.read.promise", "lookup.forced"] });
      expect(lines[1]).toMatchObject({ turn_id: "t2", text: "you're not listening, Alfred asked what time", guard_hits: ["repeat_reply"], forced_lookup: false, corrected_next_turn: false });
      expect(readFileSync(join(dir, "2026-W39.jsonl"), "utf-8")).toContain('"text":"Astro is asleep"');
      const report = weeklyReport("2026-W38", labels.slice(0, 2) as NonNullable<(typeof labels)[number]>[]);
      expect(report.guard_hits).toEqual({ repeat_reply: 1 });
      expect(report.rule_hits).toMatchObject({ "signal.rule": 2, "lookup.forced": 1, "guard.repeat_reply": 1 });
      expect(report.rungs).toEqual({ search: 1, none: 1 });
      expect(report.corrections_by_rung).toEqual({ search: 1 });
      expect(report.zero_hit_rules).toContain("almanac");
      expect(report.zero_hit_rules).toContain("guard.invention");
      expect(report.zero_hit_rules).not.toContain("lookup.forced");
      expect(knownRules()).toContain("guard.medication_dose");
      const text = formatReport(report);
      expect(text).toContain("== 2026-W38: 2 turn(s)");
      expect(text).toContain("rules with zero hits this week");
      expect(text).toContain("   almanac");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
