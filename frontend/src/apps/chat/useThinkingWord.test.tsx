import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { ReasoningGroup } from "@/apps/chat/chatThreadSlots";
import { resetThinkingWordForTests } from "@/apps/chat/useThinkingWord";
import { THINKING_WORDS, FIRST_HOLD_MS, ROTATE_MAX_MS, ROTATE_MIN_MS, nextRotationDelay, pickThinkingWord } from "@/apps/chat/thinkingWords";

const realMatchMedia = window.matchMedia;
function reduceMotion(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

function group(type: "running" | "complete") {
  return { status: { type } } as never;
}
function view(running: boolean) {
  return <ReasoningGroup group={group(running ? "running" : "complete")}>some reasoning</ReasoningGroup>;
}
const label = (c: HTMLElement) => c.querySelector('[data-slot="reasoning-trigger-label"]')?.textContent ?? "";
const status = (c: HTMLElement) => c.querySelector('[role="status"]')?.textContent ?? "";

beforeEach(() => {
  jest.useFakeTimers();
  resetThinkingWordForTests();
  reduceMotion(false);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.matchMedia = realMatchMedia;
});

describe("thinking words", () => {
  test("the list is about twenty distinct words including Thinking", () => {
    expect(THINKING_WORDS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(THINKING_WORDS).size).toBe(THINKING_WORDS.length);
    expect(THINKING_WORDS).toContain("Thinking");
  });

  test("never picks the previous word, for every previous word and random value", () => {
    for (const prev of THINKING_WORDS) for (const r of [0, 0.25, 0.5, 0.99999]) expect(pickThinkingWord(prev, () => r)).not.toBe(prev);
  });

  test("delay stays between 10 and 14 seconds", () => {
    expect(nextRotationDelay(() => 0)).toBe(10_000);
    expect(nextRotationDelay(() => 1)).toBe(14_000);
  });
});

describe("ReasoningGroup status word", () => {
  test("rotates while running and never repeats consecutively", () => {
    const { container } = render(view(true));
    const seen = [label(container)];
    for (let i = 0; i < 12; i++) {
      act(() => { jest.advanceTimersByTime(ROTATE_MAX_MS + 4000); });
      seen.push(label(container));
    }
    expect(THINKING_WORDS).toContain(seen[0] as string);
    for (let i = 1; i < seen.length; i++) {
      expect(THINKING_WORDS).toContain(seen[i] as string);
      expect(seen[i]).not.toBe(seen[i - 1]);
    }
  });

  test("does not rotate at all for the first 8 seconds", () => {
    const { container } = render(view(true));
    const first = label(container);
    act(() => { jest.advanceTimersByTime(FIRST_HOLD_MS - 1); });
    expect(label(container)).toBe(first);
  });

  test("a later word holds at least 10 seconds", () => {
    const { container } = render(view(true));
    act(() => { jest.advanceTimersByTime(FIRST_HOLD_MS + 4000); });
    const second = label(container);
    act(() => { jest.advanceTimersByTime(ROTATE_MIN_MS - 1); });
    expect(label(container)).toBe(second);
  });

  test("the next turn starts on a different word than the last one showed", () => {
    for (let i = 0; i < 20; i++) {
      const a = render(view(true));
      const shown = label(a.container);
      a.unmount();
      const b = render(view(true));
      expect(label(b.container)).not.toBe(shown);
      b.unmount();
    }
  });

  test("reduced motion shows a static Thinking and sets no timer", () => {
    reduceMotion(true);
    const { container } = render(view(true));
    expect(label(container)).toBe("Thinking");
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(label(container)).toBe("Thinking");
  });

  test("the live region says Thinking once and Done thinking at the end, not each word", () => {
    const { container, rerender } = render(view(true));
    expect(status(container)).toBe("Thinking");
    const region = container.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-live")).toBe("polite");
    for (let i = 0; i < 5; i++) {
      act(() => { jest.advanceTimersByTime(ROTATE_MAX_MS + 4000); });
      expect(status(container)).toBe("Thinking");
    }
    act(() => { jest.advanceTimersByTime(1000); });
    rerender(view(false));
    expect(container.querySelectorAll('[role="status"]').length).toBe(1);
    expect(status(container)).toBe("Done thinking");
  });

  test("finished it reads Thought for Ns, minimum 1", () => {
    const { container, rerender } = render(view(true));
    act(() => { jest.advanceTimersByTime(7000); });
    rerender(view(false));
    expect(label(container)).toContain("Thought for 7s");
  });

  test("a group that never ran keeps the plain Reasoning label and no announcement", () => {
    const { container } = render(view(false));
    expect(label(container)).toBe("Reasoning");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
