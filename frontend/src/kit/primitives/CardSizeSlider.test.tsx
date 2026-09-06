import { describe, expect, test, mock, afterEach } from "bun:test";
import { renderHook, render, fireEvent, act, cleanup } from "@testing-library/react";
import {
  useCardSize,
  cardSizeStyle,
  cardSizeGridTemplateColumns,
  CardSizeSlider,
  CARD_SIZE_DEFAULT,
  CARD_SIZE_MIN,
  CARD_SIZE_MAX,
} from "@/kit/primitives/CardSizeSlider";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useCardSize", () => {
  test("defaults to CARD_SIZE_DEFAULT with nothing stored", () => {
    const { result } = renderHook(() => useCardSize("home"));
    expect(result.current[0]).toBe(CARD_SIZE_DEFAULT);
  });

  test("persists a chosen size under an app-scoped key", () => {
    const { result, rerender } = renderHook(() => useCardSize("home"));
    act(() => result.current[1](340));
    expect(result.current[0]).toBe(340);
    expect(window.localStorage.getItem("maipai:card-size:home")).toBe("340");

    // A second hook instance for the same app picks up the persisted value.
    const { result: second } = renderHook(() => useCardSize("home"));
    expect(second.current[0]).toBe(340);
    rerender();
  });

  test("a different app has its own independent size", () => {
    const home = renderHook(() => useCardSize("home"));
    act(() => home.result.current[1](500));
    const chat = renderHook(() => useCardSize("chat"));
    expect(chat.result.current[0]).toBe(CARD_SIZE_DEFAULT);
  });

  test("clamps a value outside 180-560", () => {
    const { result } = renderHook(() => useCardSize("home"));
    act(() => result.current[1](50));
    expect(result.current[0]).toBe(CARD_SIZE_MIN);
    act(() => result.current[1](9999));
    expect(result.current[0]).toBe(CARD_SIZE_MAX);
  });

  test("a corrupted stored value falls back to the default rather than throwing", () => {
    window.localStorage.setItem("maipai:card-size:home", "not-a-number");
    const { result } = renderHook(() => useCardSize("home"));
    expect(result.current[0]).toBe(CARD_SIZE_DEFAULT);
  });
});

describe("CardSizeSlider", () => {
  test("is fully controlled - a drag reports through onChange rather than an internal useCardSize call", () => {
    // The regression this guards: an earlier version called its own
    // `useCardSize` internally, so a caller applying `size` to a grid
    // (HomePage.tsx's `cardSizeStyle`) never learned about a drag - the
    // thumb moved, the grid never resized, until a remount (a code
    // review, 2026-09-06).
    const onChange = mock((_next: number) => {});
    const { getByRole } = render(<CardSizeSlider size={300} onChange={onChange} />);
    const thumb = getByRole("slider");
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(320);
  });
});

describe("cardSizeStyle / cardSizeGridTemplateColumns", () => {
  test("cardSizeStyle sets the one CSS variable every grid consumes", () => {
    expect(cardSizeStyle(300)).toEqual({ "--maipai-card-size": "300px" } as Record<string, string>);
  });

  test("the grid template reads the same variable name with a sane fallback", () => {
    const template = cardSizeGridTemplateColumns();
    expect(template).toContain("--maipai-card-size");
    expect(template).toContain(`${CARD_SIZE_DEFAULT}px`);
  });
});
