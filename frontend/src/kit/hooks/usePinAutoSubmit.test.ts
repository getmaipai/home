import { describe, expect, test, mock } from "bun:test";
import { renderHook } from "@testing-library/react";
import { usePinAutoSubmit } from "@/kit/hooks/usePinAutoSubmit";

describe("usePinAutoSubmit", () => {
  test("fires once a 4-digit PIN lands", () => {
    const onSubmit = mock(() => {});
    const { rerender } = renderHook(
      ({ secret }: { secret: string }) => usePinAutoSubmit({ secret, selected: { id: "p1" }, pinDigits: 4, busy: false, onSubmit }),
      { initialProps: { secret: "12" } },
    );
    expect(onSubmit).not.toHaveBeenCalled();

    rerender({ secret: "1234" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("never fires for a non-4-digit value, even a longer numeric one", () => {
    const onSubmit = mock(() => {});
    const { rerender } = renderHook(
      ({ secret }: { secret: string }) => usePinAutoSubmit({ secret, selected: { id: "p1" }, pinDigits: 4, busy: false, onSubmit }),
      { initialProps: { secret: "" } },
    );
    rerender({ secret: "12345" });
    rerender({ secret: "abcd" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("fires at most once per selected value, even if secret/busy churn afterward (the success-path infinite-loop bug this hook exists to close)", () => {
    const onSubmit = mock(() => {});
    // A stable reference across rerenders, unlike a fresh object literal
    // per render - the real components pass the same `selected` state
    // value across re-renders that don't change which profile is picked,
    // and the reset effect (keyed on this exact reference) must not
    // mistake "still the same profile" for "a fresh attempt."
    const selected = { id: "p1" };
    const { rerender } = renderHook(
      ({ secret, busy }: { secret: string; busy: boolean }) =>
        usePinAutoSubmit({ secret, selected, pinDigits: 4, busy, onSubmit }),
      { initialProps: { secret: "1234", busy: false } },
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Simulates a successful sign-in that never cleared `secret` and cycled
    // `busy` back to false once the request resolved.
    rerender({ secret: "1234", busy: true });
    rerender({ secret: "1234", busy: false });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("a new selected value resets the guard for a fresh attempt", () => {
    const onSubmit = mock(() => {});
    const { rerender } = renderHook(
      ({ selected }: { selected: { id: string } | null }) =>
        usePinAutoSubmit({ secret: "1234", selected, pinDigits: 4, busy: false, onSubmit }),
      { initialProps: { selected: { id: "p1" } as { id: string } | null } },
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender({ selected: { id: "p2" } });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  test("does not fire while busy", () => {
    const onSubmit = mock(() => {});
    renderHook(() => usePinAutoSubmit({ secret: "1234", selected: { id: "p1" }, busy: true, onSubmit }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("does not fire when nothing is selected", () => {
    const onSubmit = mock(() => {});
    renderHook(() => usePinAutoSubmit({ secret: "1234", selected: null, busy: false, onSubmit }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a second, different PIN retries automatically after a wrong first attempt (a code review found a plain boolean guard would permanently disable this)", () => {
    const onSubmit = mock(() => {});
    const selected = { id: "p1" };
    const { rerender } = renderHook(
      ({ secret, busy }: { secret: string; busy: boolean }) =>
        usePinAutoSubmit({ secret, selected, pinDigits: 4, busy, onSubmit }),
      { initialProps: { secret: "1234", busy: false } },
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // The first PIN was wrong: busy cycles through a failed request, and
    // the user backspaces and retypes a different 4-digit value.
    rerender({ secret: "1234", busy: true });
    rerender({ secret: "1234", busy: false });
    rerender({ secret: "123", busy: false });
    rerender({ secret: "5678", busy: false });

    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  test("a 6-digit PIN never fires at 4 digits and fires once at 6", () => {
    const onSubmit = mock(() => {});
    const { rerender } = renderHook(
      ({ secret }: { secret: string }) => usePinAutoSubmit({ secret, selected: { id: "p1" }, pinDigits: 6, busy: false, onSubmit }),
      { initialProps: { secret: "" } },
    );
    for (const v of ["1", "12", "123", "1234", "12345"]) rerender({ secret: v });
    expect(onSubmit).not.toHaveBeenCalled();
    rerender({ secret: "123456" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("an unknown length (null, undefined or 0) never auto-submits, at any length", () => {
    for (const pinDigits of [null, undefined, 0]) {
      const onSubmit = mock(() => {});
      const { rerender } = renderHook(
        ({ secret }: { secret: string }) => usePinAutoSubmit({ secret, selected: { id: "p1" }, pinDigits, busy: false, onSubmit }),
        { initialProps: { secret: "" } },
      );
      for (const v of ["1234", "123456", "12345678"]) rerender({ secret: v });
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });
});

describe("usePinAutoSubmit after a wrong code clears the boxes", () => {
  test("the same code typed again submits again, and a shorter entry never does", () => {
    const onSubmit = mock(() => {});
    const selected = { id: "p1" };
    const { rerender } = renderHook(
      ({ secret }: { secret: string }) => usePinAutoSubmit({ secret, selected, pinDigits: 6, busy: false, onSubmit }),
      { initialProps: { secret: "" } },
    );
    rerender({ secret: "123456" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender({ secret: "" });
    rerender({ secret: "12345" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender({ secret: "123456" });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
