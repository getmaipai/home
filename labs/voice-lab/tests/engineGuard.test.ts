import { test, expect } from "bun:test";
import { ensureChat } from "../src/engineGuard";
const mk = (healthSeq: boolean[]) => { const ev: string[] = []; let i = 0; return { ev, d: { health: async () => healthSeq[Math.min(i++, healthSeq.length - 1)], start: async () => { ev.push("start"); }, warm: async () => { ev.push("warm"); }, sleep: async () => {}, log: (o: any) => ev.push(o.event), waitMs: 6000 } }; };
test("engine up: only warms", async () => { const { d, ev } = mk([true, true]); expect(await ensureChat(d)).toBe("ready"); expect(ev).toEqual(["warm"]); });
test("engine down: starts it, waits, warms", async () => { const { d, ev } = mk([false, false, true, true]); expect(await ensureChat(d)).toBe("ready"); expect(ev).toEqual(["chat-down", "start", "chat-started", "warm"]); });
test("guard stops it again: waiting memory, not a failure", async () => { const { d, ev } = mk([false]); expect(await ensureChat(d)).toBe("waiting-memory"); expect(ev).toContain("waiting: memory"); expect(ev).not.toContain("warm"); });
