import { describe, expect, test } from "bun:test";
import { MAX_RECONNECT_ATTEMPTS, reconnectDelayMs, watchLiveReconnect, type ReconnectTimers } from "@/lib/media/liveReconnect";

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: ReconnectTimers = {
    set: (fn, ms) => { seq += 1; pending.set(seq, { at: now + ms, fn }); return seq as unknown as ReturnType<typeof setTimeout>; },
    clear: (t) => { pending.delete(t as unknown as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, p] of [...pending]) if (p.at <= now) { pending.delete(id); p.fn(); }
  };
  return { timers, advance, size: () => pending.size };
}

function setup() {
  const el = document.createElement("audio");
  el.play = () => Promise.resolve();
  const t = fakeTimers();
  let reloads = 0;
  let gaveUp = 0;
  const stop = watchLiveReconnect(el, () => { reloads += 1; }, () => { gaveUp += 1; }, t.timers);
  return { el, t, stop, reloads: () => reloads, gaveUp: () => gaveUp };
}

describe("reconnectDelayMs", () => {
  test("backs off 1, 2, 4, 8 seconds then gives up", () => {
    expect([1, 2, 3, 4].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(reconnectDelayMs(5)).toBeNull();
    expect(reconnectDelayMs(0)).toBeNull();
    expect(MAX_RECONNECT_ATTEMPTS).toBe(4);
  });
});

describe("watchLiveReconnect", () => {
  test("an error retries once after 1000 ms and says nothing", () => {
    const s = setup();
    s.el.dispatchEvent(new Event("error"));
    s.el.dispatchEvent(new Event("stalled"));
    s.t.advance(999);
    expect(s.reloads()).toBe(0);
    s.t.advance(1);
    expect(s.reloads()).toBe(1);
    expect(s.gaveUp()).toBe(0);
  });

  test("gives up only after four failed retries", () => {
    const s = setup();
    for (const wait of [1000, 2000, 4000, 8000]) {
      s.el.dispatchEvent(new Event("error"));
      expect(s.gaveUp()).toBe(0);
      s.t.advance(wait);
    }
    expect(s.reloads()).toBe(4);
    s.el.dispatchEvent(new Event("error"));
    expect(s.gaveUp()).toBe(1);
    s.el.dispatchEvent(new Event("error"));
    expect(s.gaveUp()).toBe(1);
  });

  test("playing resets the count", () => {
    const s = setup();
    s.el.dispatchEvent(new Event("error"));
    s.t.advance(1000);
    s.el.dispatchEvent(new Event("playing"));
    s.el.dispatchEvent(new Event("error"));
    s.t.advance(1000);
    expect(s.reloads()).toBe(2);
  });

  test("a pause by the person cancels the retry", () => {
    const s = setup();
    s.el.dispatchEvent(new Event("error"));
    s.el.dispatchEvent(new Event("pause"));
    s.t.advance(10000);
    expect(s.reloads()).toBe(0);
    s.el.dispatchEvent(new Event("error"));
    expect(s.t.size()).toBe(0);
  });

  test("cleanup cancels a pending retry", () => {
    const s = setup();
    s.el.dispatchEvent(new Event("error"));
    s.stop();
    s.t.advance(10000);
    expect(s.reloads()).toBe(0);
  });
});
