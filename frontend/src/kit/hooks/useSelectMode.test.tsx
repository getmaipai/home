import { describe, expect, test } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useSelectMode } from "@/kit/hooks/useSelectMode";

describe("useSelectMode", () => {
  test("toggle adds then removes an id", () => {
    const { result } = renderHook(() => useSelectMode(["a", "b", "c"]));

    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.count).toBe(1);

    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.count).toBe(0);
  });

  test("selectAll selects exactly the ids passed in", () => {
    const { result } = renderHook(() => useSelectMode(["a", "b", "c"]));

    act(() => result.current.selectAll());
    expect([...result.current.selected].sort()).toEqual(["a", "b", "c"]);
    expect(result.current.count).toBe(3);
  });

  test("exit clears selection and leaves select mode", () => {
    const { result } = renderHook(() => useSelectMode(["a", "b"]));

    act(() => result.current.enter());
    act(() => result.current.toggle("a"));
    expect(result.current.active).toBe(true);
    expect(result.current.count).toBe(1);

    act(() => result.current.exit());
    expect(result.current.active).toBe(false);
    expect(result.current.count).toBe(0);
  });

  test("an id removed from ids on rerender disappears from selected and count", () => {
    const { result, rerender } = renderHook(({ ids }: { ids: readonly string[] }) => useSelectMode(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });

    act(() => {
      result.current.toggle("a");
      result.current.toggle("b");
    });
    expect(result.current.count).toBe(2);

    rerender({ ids: ["a", "c"] });
    expect(result.current.isSelected("b")).toBe(false);
    expect(result.current.count).toBe(1);
  });

  test("entering select mode selects nothing", () => {
    const { result } = renderHook(() => useSelectMode(["a", "b"]));

    act(() => result.current.enter());
    expect(result.current.active).toBe(true);
    expect(result.current.count).toBe(0);
  });

  test("selectAll then a smaller ids on rerender gives count === ids.length", () => {
    const { result, rerender } = renderHook(({ ids }: { ids: readonly string[] }) => useSelectMode(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });

    act(() => result.current.selectAll());
    expect(result.current.count).toBe(3);

    rerender({ ids: ["a", "b"] });
    expect(result.current.count).toBe(2);
  });
});
