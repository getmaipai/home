// "A person is testing" = a page (not a test rig) with an open socket that has moved a message in EITHER direction in the last 120 s (microphone frames, replies, pushes).
// An idle open tab is connected but not active and does not block runs, restarts or rigs; a tab listening to a long reply stays active because the server keeps sending.
export const ACTIVE_MS = 120_000;
export class LiveTracker {
  private pages = new Map<unknown, number>();
  add(ws: unknown, now = Date.now()) { this.pages.set(ws, now); }
  delete(ws: unknown) { this.pages.delete(ws); }
  touch(ws: unknown, now = Date.now()) { if (this.pages.has(ws)) this.pages.set(ws, now); }
  get size() { return this.pages.size; }
  active(now = Date.now(), activeMs = ACTIVE_MS) { let n = 0; for (const t of this.pages.values()) if (now - t <= activeMs) n++; return n; }
  counts(now = Date.now()) { return { connected: this.pages.size, active: this.active(now), live: this.active(now) }; }
}
