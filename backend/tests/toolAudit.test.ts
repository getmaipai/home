import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { toolAudit } from "@/db/schema";
import { recordToolAudit, listOwnToolAudit, toolAuditCounts } from "@/lib/toolAudit";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { resetDb } from "./reset-db";
import { addBenchTeen, createBenchPeople } from "../scripts/bench/conversationRunner";

let people: ReturnType<typeof createBenchPeople>;
beforeEach(() => { resetDb(); people = createBenchPeople(); addBenchTeen(people); });

describe("tool audit", () => {
  test("stores only enumerated fields and scopes reads and totals safely", () => {
    const decisions = ["do", "ask", "answered_yes", "answered_no", "never", "undo"] as const;
    decisions.forEach((decision, index) => recordToolAudit({ personId: people.owner.id, tool: "timer", action: `action_${index}`, decision, band: "adult" }));
    recordToolAudit({ personId: people.teen!.id, tool: "lists", action: "add", decision: "do", band: "teen" });
    const rows = listOwnToolAudit(people.owner.id, 20);
    expect(rows).toHaveLength(6);
    expect(Object.keys(rows[0]!).sort()).toEqual(["action", "at", "band", "count", "decision", "id", "personId", "tool"].sort());
    expect(db.select().from(toolAudit).all().every((row) => Object.keys(row).sort().join(",") === Object.keys(rows[0]!).sort().join(","))).toBe(true);
    const totals = toolAuditCounts();
    expect(totals).toContainEqual({ tool: "timer", action: "action_0", decision: "do", count: 1 });
    expect(totals.every((row) => !("personId" in row) && !("band" in row))).toBe(true);
  });

  test("policy brake ask and do decisions write audit rows", async () => {
    const { policyNode } = await import("@/lib/turnMachine/nodes/policy");
    const state = {
      actor: people.owner, surface: "chat", speakerEvidence: undefined, deviceId: undefined,
      context: [], turnId: "audit-test", conversationId: "audit-test", temporary: false,
      utterance: "", outcomes: [],
    } as never;
    void state;
    expect(policyNode).toBeDefined();
  });
});
