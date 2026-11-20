import { expect, test } from "bun:test";
import { LiveTracker, ACTIVE_MS } from "../src/liveTracker";
test("an idle open tab does not block (connected but not active); an active tab does; a tab listening to a long reply stays active", () => {
  const t = new LiveTracker(); const idle = {}, active = {}, listening = {};
  t.add(idle, 0); t.add(active, 0); t.add(listening, 0);
  t.touch(active, ACTIVE_MS + 30_000);                                  // the person spoke 30 s ago relative to now
  for (let s = 0; s <= ACTIVE_MS + 60_000; s += 10_000) t.touch(listening, s);   // the server keeps sending a long reply
  const now = ACTIVE_MS + 60_000; const c = t.counts(now);
  expect(c.connected).toBe(3); expect(c.active).toBe(2); expect(c.live).toBe(2);
  t.delete(active); t.delete(listening); expect(t.counts(now)).toEqual({ connected: 1, active: 0, live: 0 });
});
test("touching a socket that is not tracked (a test rig) does nothing", () => { const t = new LiveTracker(); t.touch({}, 5); expect(t.counts(10)).toEqual({ connected: 0, active: 0, live: 0 }); });
