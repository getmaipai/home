// TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 4): the client state machine on the cases the design names.
import { describe, expect, test } from "bun:test";
import { CLIP_TAIL_MS, ECHO_MARGIN_MS, TalkOverController, WINDOW_MAX_MS, WINDOW_STEP_MS, firesAt } from "@/lib/voice/talkOver";

const grant = { level: "natural" as const, window_ms: 800, clips: ["Mm-hm.", "Okay."] };
const CONV = "conv-1";

describe("TALK-OVER-01: the protected overlap window", () => {
  test("still talking at the window's end stops and discards; the back-off counts it", () => {
    const control = new TalkOverController(grant);
    const overlap = control.open(CONV, 1000, 450);
    expect(overlap.windowEndsAt).toBe(1800);
    control.noteResumed(overlap, 1600); // after the clip (ends 1450) plus the margin
    expect(control.decide(CONV, overlap, 1700)).toBe("none"); // inside the window nothing is decided
    expect(control.decide(CONV, overlap, 1800)).toBe("continued");
    expect(control.state(CONV).wrongStarts).toBe(1);
    expect(control.state(CONV).windowMs).toBe(800 + WINDOW_STEP_MS);
  });

  test("stopped at the window's end continues, and the final confirms", () => {
    const control = new TalkOverController(grant);
    const overlap = control.open(CONV, 1000, 450);
    expect(control.decide(CONV, overlap, 1800)).toBe("none");
    expect(control.confirm(overlap)).toBe("confirmed");
    expect(control.decide(CONV, overlap, 2500)).toBe("confirmed");
    expect(control.state(CONV).wrongStarts).toBe(0);
  });

  test("a sound inside the clip's own playback is echo and changes nothing; a short sound the hub never reports changes nothing", () => {
    const control = new TalkOverController(grant);
    const overlap = control.open(CONV, 1000, 450);
    control.noteResumed(overlap, 1450 + ECHO_MARGIN_MS); // exactly at the margin: still the clip
    expect(overlap.resumedAt).toBeNull();
    expect(control.decide(CONV, overlap, 1800)).toBe("none");
    expect(control.confirm(overlap)).toBe("confirmed");
  });

  test("a later partial with more words counts as the person going on even when the resume fell inside the clip", () => {
    const control = new TalkOverController(grant);
    const overlap = control.open(CONV, 1000, 450);
    control.noteResumed(overlap, 1200);
    control.noteMoreWords(overlap);
    expect(control.decide(CONV, overlap, 1800)).toBe("continued");
  });

  test("the window never ends before the clip plus its tail", () => {
    const control = new TalkOverController({ ...grant, window_ms: 500 });
    const overlap = control.open(CONV, 0, 600);
    expect(overlap.windowEndsAt).toBe(600 + CLIP_TAIL_MS);
  });

  test("two wrong starts in one conversation drop the level one step, then again to off; another conversation is untouched", () => {
    const control = new TalkOverController(grant);
    for (let i = 0; i < 2; i++) { const overlap = control.open(CONV, 0, 400); control.noteResumed(overlap, 700); control.decide(CONV, overlap, 900); }
    expect(control.state(CONV).level).toBe("gentle");
    expect(control.shouldPlay(CONV, "natural")).toBe(false);
    expect(control.shouldPlay(CONV, "gentle")).toBe(true);
    for (let i = 0; i < 2; i++) { const overlap = control.open(CONV, 0, 400); control.continuedAtFinal(CONV, overlap); }
    expect(control.state(CONV).level).toBe("off");
    expect(control.shouldPlay(CONV, "gentle")).toBe(false);
    expect(control.state(CONV).windowMs).toBe(Math.min(WINDOW_MAX_MS, 800 + 4 * WINDOW_STEP_MS));
    expect(control.state("conv-2").level).toBe("natural");
  });

  test("a decision is made once: a confirm after continued, or a second decide, changes nothing", () => {
    const control = new TalkOverController(grant);
    const overlap = control.open(CONV, 0, 400);
    control.noteResumed(overlap, 700);
    expect(control.decide(CONV, overlap, 900)).toBe("continued");
    expect(control.confirm(overlap)).toBe("continued");
    expect(control.decide(CONV, overlap, 1500)).toBe("continued");
    expect(control.state(CONV).wrongStarts).toBe(1);
  });

  test("the level order: gentle fires on gentle only, natural on both, off never", () => {
    expect(firesAt("gentle", "gentle")).toBe(true);
    expect(firesAt("gentle", "natural")).toBe(false);
    expect(firesAt("natural", "natural")).toBe(true);
    expect(firesAt("off", "gentle")).toBe(false);
    expect(firesAt("natural", "none")).toBe(false);
  });
});
