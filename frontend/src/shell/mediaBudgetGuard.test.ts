import { afterEach, beforeEach, expect, test } from "bun:test";
import { guardMediaBudget, type BudgetRead } from "./mediaBudgetGuard";

/** A stand-in for the host's media element: plays, pauses and fires the same events. */
class FakeMedia extends EventTarget {
  paused = true;
  play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
  pause() { if (this.paused) return; this.paused = true; this.dispatchEvent(new Event("pause")); }
}

const LINE = "Screen time is done for today. Ask a grown-up for more.";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let timers: Array<() => void> = [];
const tickTimers = async () => { for (const run of timers) run(); await flush(); };
const every = (run: () => void) => { timers.push(run); return () => { timers = timers.filter((r) => r !== run); }; };
beforeEach(() => { timers = []; });
afterEach(() => { timers = []; });

function setup(reads: Array<BudgetRead | Error>) {
  const el = new FakeMedia();
  const shown: string[] = [];
  let calls = 0;
  const fetchBudget = async () => {
    const next = reads[Math.min(calls, reads.length - 1)]!;
    calls += 1;
    if (next instanceof Error) throw next;
    return next;
  };
  const stop = guardMediaBudget(el as unknown as HTMLMediaElement, { fetchBudget, notify: (line) => shown.push(line), every });
  return { el, shown, stop, calls: () => calls };
}

const left = (exhausted: boolean, limit = 1): BudgetRead => ({ limit_min: limit, used_min: exhausted ? 1 : 0.5, left_min: exhausted ? 0 : 0.5, exhausted, line: exhausted ? LINE : null });

test("a person whose time runs out while the element keeps playing (a fully buffered video) is paused, and the kid line shows once", async () => {
  const { el, shown } = setup([left(false), left(false), left(true)]); // attach, play, then the timer
  await el.play(); await flush();
  expect(el.paused).toBe(false);
  await tickTimers(); // the 15 s check finds the time is up
  expect(el.paused).toBe(true);
  expect(shown).toEqual([LINE]);
  await tickTimers();
  expect(shown).toEqual([LINE]); // once, not on every check
});

test("pressing play after time is up is blocked at once, before any fetch answers", async () => {
  const { el, shown } = setup([left(false), left(false), left(true)]);
  await el.play(); await flush();
  await tickTimers();
  expect(el.paused).toBe(true);
  void el.play();
  expect(el.paused).toBe(true);
  expect(shown).toEqual([LINE]);
});

test("each play checks the budget, and an extension a grown-up added lets the next play through", async () => {
  const { el, calls } = setup([left(false), left(true), left(false)]);
  await flush(); // the check on attach
  await el.play(); await flush();
  expect(calls()).toBe(2);
  expect(el.paused).toBe(true);
  await el.play(); await flush(); // blocked, then the recheck sees the extension
  expect(calls()).toBe(3);
  await el.play(); await flush();
  expect(el.paused).toBe(false);
});

test("no limit (an adult, or a child with no minutes set) is never paused", async () => {
  const { el, shown } = setup([{ limit_min: 0, used_min: 30, left_min: 0, exhausted: false, line: null }]);
  await el.play(); await flush();
  await tickTimers(); await tickTimers();
  expect(el.paused).toBe(false);
  expect(shown).toEqual([]);
});

test("a failed budget read neither pauses nor throws", async () => {
  const { el, shown } = setup([new Error("offline")]);
  await el.play(); await flush();
  await tickTimers();
  expect(el.paused).toBe(false);
  expect(shown).toEqual([]);
});

test("a check runs only while the element plays, and stopping the guard removes it", async () => {
  const { el, stop, calls } = setup([left(false)]);
  await flush();
  expect(calls()).toBe(1); // the check on attach
  await tickTimers();
  expect(calls()).toBe(1); // paused: no polling
  await el.play(); await flush();
  const afterPlay = calls();
  await tickTimers();
  expect(calls()).toBe(afterPlay + 1);
  stop();
  expect(timers).toEqual([]);
  await el.play(); await flush();
  expect(calls()).toBe(afterPlay + 1);
});

test("opening a player when time is already up shows the kid line without any play (the file itself is refused)", async () => {
  const { el, shown } = setup([left(true)]);
  await flush();
  expect(shown).toEqual([LINE]);
  expect(el.paused).toBe(true);
});

test("a load error (the hub refused the file) checks the budget and shows the line", async () => {
  const { el, shown } = setup([left(false), left(true)]);
  await flush();
  expect(shown).toEqual([]);
  el.dispatchEvent(new Event("error"));
  await flush();
  expect(shown).toEqual([LINE]);
});
