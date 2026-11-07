// AUDIT-DUP-FE-01: the one mark flow behind the picture and the video controls, exercised with a fake api and an identity `toAction`.
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { HUB_DOWN_LINE } from "@/lib/hubReachability";
import { useAdultMark, type AdultMarkApi, type AdultMarkItem } from "@/apps/chat/useAdultMark";

afterEach(cleanup);
const apiWith = (adultMark: AdultMarkApi["adultMark"]): AdultMarkApi => ({ confirmUnmark: async () => ({ ticket: "t" }), adultMark });
const item = (over: Partial<NonNullable<AdultMarkItem["adult"]>>): AdultMarkItem => ({ id: "i-1", adult: { can_clear: false, can_mark: true, line: "Not marked.", ...over } });

describe("useAdultMark", () => {
  test("offers only the actions the item allows, and nothing for an item with no adult state", () => {
    const only = renderHook(() => useAdultMark(apiWith(async () => ({})), item({}), () => undefined, (a) => a.id));
    expect(only.result.current.actions).toEqual(["adult-mark"]);
    expect(only.result.current.dialog).toBeNull();
    const both = renderHook(() => useAdultMark(apiWith(async () => ({})), item({ can_clear: true }), () => undefined, (a) => a.id));
    expect(both.result.current.actions).toEqual(["adult-unmark", "adult-mark"]);
    expect(both.result.current.dialog).not.toBeNull();
    const none = renderHook(() => useAdultMark(apiWith(async () => ({})), { id: "i-2", adult: null }, () => undefined, (a) => a.id));
    expect(none.result.current).toEqual({ actions: [], dialog: null, stateLine: null });
  });

  test("a failed mark shows the hub's own words, or the restarting line when the hub did not answer, then refreshes", async () => {
    let failure: unknown = new ApiError("Change this on your own screen.", 403);
    let refreshed = 0;
    const view = renderHook(() => useAdultMark(apiWith(async () => { throw failure; }), item({}), () => { refreshed += 1; }, (a) => a));
    act(() => view.result.current.actions[0]!.onSelect());
    await waitFor(() => expect(view.result.current.stateLine).toBe("Change this on your own screen."));
    expect(refreshed).toBe(1);
    failure = new TypeError("Failed to fetch");
    act(() => view.result.current.actions[0]!.onSelect());
    await waitFor(() => expect(view.result.current.stateLine).toBe(HUB_DOWN_LINE));
  });
});
