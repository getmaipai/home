// CODE-TIER-05: the tier and queue behaviors of a Code session, end to end on fakes. Some are also pinned in codingSessions.test.ts at unit level; here each
// is one flow the person lives through: a restart, a removed grant, a chat that holds a request, the queue's own line, a refused Max lease and the one-message Standard fallback.
import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codingSessions } from "@/db/schema";
import { createGrant, listGrants, revokeGrant } from "@/lib/grants";
import { invalidatePass } from "@/lib/filter/passCache";
import { createCodingSession, getCodingSession, settleSessionsAtStartup } from "@/lib/codingSessions";
import { __resetCodingTurnsForTests, offersUseStandard, setCodingRuntime, submitTurn, turnFinished, turnQueueLine, turnState, useStandardForThisMessage } from "@/lib/codingTurns";
import { input, owner, person, settled, startRig } from "./codingRig";

let rig: ReturnType<typeof startRig>;
afterEach(() => rig?.restore());

describe("a session's tier and the coding queue (CODE-TIER-05)", () => {
  test("a Max session keeps Max across a hub restart, even with a turn that was waiting when it went down", async () => {
    rig = startRig();
    const boss = owner(); const other = owner();
    expect((await rig.lease.acquire(other)).ok).toBe(true); // a Max chat holds the lease, so the Max turn waits
    const s = createCodingSession(boss, input({ tier: "max" }));
    submitTurn(boss, s.id, "go"); await settled();
    expect(getCodingSession(boss, s.id)!.state).toBe("queued");
    __resetCodingTurnsForTests(); // the hub restarts: the in-memory queue is gone
    setCodingRuntime({ agent: rig.agent.agent, sandbox: rig.sandbox.sandbox, lease: () => rig.lease });
    expect(settleSessionsAtStartup()).toBe(1);
    expect(getCodingSession(boss, s.id)).toMatchObject({ tier: "max", state: "idle" });
    expect(db.select().from(codingSessions).where(eq(codingSessions.id, s.id)).get()!.tier).toBe("max");
  });

  test("a removed grant lowers the next turn and writes the lower tier back to the record", async () => {
    rig = startRig();
    const boss = owner(); const a = person();
    const made = createGrant({ id: boss.id, role: "owner" }, { person: a.id, action: "tier.max:coding", effect: "allow", acknowledged_at: new Date().toISOString(), acknowledged_by_person_id: boss.id });
    expect(made.ok).toBe(true); invalidatePass(a.id);
    const s = createCodingSession(a, input({ tier: "max" })); expect(s.tier).toBe("max");
    expect(revokeGrant(listGrants(a.id).find((g) => g.action === "tier.max:coding")!.id).ok).toBe(true); invalidatePass(a.id);
    const sent = submitTurn(a, s.id, "hello"); await settled();
    expect(rig.agent.calls[0]!.tier).not.toBe("max"); expect(getCodingSession(a, s.id)!.tier).toBe(rig.agent.calls[0]!.tier); expect(rig.swaps).toEqual([]);
    rig.agent.finishAll(); await turnFinished(sent.turn_id);
  });

  test("another person's Max chat delays a Max coding request; it never fails, and it runs when the chat lets go", async () => {
    rig = startRig();
    const boss = owner(); const other = owner();
    expect((await rig.lease.acquire(other)).ok).toBe(true);
    const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    expect(turnState(sent.turn_id)).toBe("queued"); expect(rig.agent.calls).toEqual([]);
    expect(getCodingSession(boss, s.id)!.state).toBe("queued"); // waiting, not failed
    expect(turnQueueLine(boss, sent.turn_id)).toContain("Max chat");
    await rig.lease.release(); await new Promise((r) => setTimeout(r, 80)); await settled(); // the retry timer asks again
    expect(turnState(sent.turn_id)).toBe("running"); expect(rig.agent.calls[0]!.tier).toBe("max");
    rig.agent.finishAll(); await turnFinished(sent.turn_id);
    expect(turnState(sent.turn_id)).toBe("done"); expect(getCodingSession(boss, s.id)!.state).toBe("idle");
  });

  test("a queued turn shows the queue's own line, and only to its owner; it clears when the turn runs", async () => {
    rig = startRig();
    const boss = owner(); const other = owner();
    expect((await rig.lease.acquire(other)).ok).toBe(true);
    const s = createCodingSession(boss, input({ tier: "max" }));
    const sent = submitTurn(boss, s.id, "go"); await settled();
    const line = turnQueueLine(boss, sent.turn_id);
    expect(line).toBeTruthy(); expect(line).not.toContain(s.id); expect(line).not.toContain("go");
    expect(turnQueueLine(other, sent.turn_id)).toBeNull();
    expect(useStandardForThisMessage(boss, sent.turn_id)).toBe(true); await settled();
    expect(turnQueueLine(boss, sent.turn_id)).toBeNull();
    rig.agent.finishAll(); await turnFinished(sent.turn_id);
  });

  test("a refused Max lease waits; the one-message Standard fallback runs once and the session stays on Max for the next message", async () => {
    rig = startRig();
    const boss = owner(); const other = owner();
    expect((await rig.lease.acquire(other)).ok).toBe(true);
    const s = createCodingSession(boss, input({ tier: "max" }));
    const first = submitTurn(boss, s.id, "one"); await settled();
    expect(turnState(first.turn_id)).toBe("queued"); expect(offersUseStandard(first.turn_id)).toBe(true);
    expect(useStandardForThisMessage(boss, first.turn_id)).toBe(true); await settled();
    expect(rig.agent.calls[0]!.tier).toBe("standard"); expect(getCodingSession(boss, s.id)!.tier).toBe("max");
    rig.agent.finishAll(); await turnFinished(first.turn_id);
    await rig.lease.release(); // the chat ends
    const second = submitTurn(boss, s.id, "two"); await settled();
    expect(rig.agent.calls[1]!.tier).toBe("max"); expect(getCodingSession(boss, s.id)!.tier).toBe("max");
    rig.agent.finishAll(); await turnFinished(second.turn_id);
  });
});
