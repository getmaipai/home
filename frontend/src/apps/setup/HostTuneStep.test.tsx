import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { HostTuneStep, hostTuneFailure, useHostTuneSupported } from "./HostTuneStep";
import { ApiError, type HostTuneItem } from "@/lib/api";

afterEach(cleanup);

const item = (over: Partial<HostTuneItem>): HostTuneItem => ({ id: "x", title: "Item", why: "Because.", mode: "auto", state: "needs", current: "off", proposed: "on", ...over });
const AUTO = item({ id: "lowpower", title: "Keep the Mac awake", why: "Sleep stops downloads.", mode: "auto" });
const CONSENT = item({ id: "wired", title: "Use more graphics memory", why: "Bigger models fit.", mode: "consent", current: "75%", proposed: "90%" });
const ADVICE = item({ id: "fv", title: "Plug in the Mac", why: "It runs slower on battery.", mode: "advice", proposed: "Use the charger." });

function stub(view: unknown, handlers: Record<string, (body: { id: string }) => Response> = {}) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${String(init.body)}` : ""}`);
    for (const [path, handler] of Object.entries(handlers)) if (url.endsWith(path)) return handler(JSON.parse(String(init?.body ?? "{}")));
    if (url.endsWith("/api/setup/host-tune")) return view instanceof Response ? view : new Response(JSON.stringify(view), { status: 200 });
    throw new Error(`Unstubbed request ${url}`);
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe("HostTuneStep", () => {
  test("loading shows a status line before the items arrive", async () => {
    const h = stub({ supported: true, items: [AUTO] });
    try {
      const view = render(<HostTuneStep onSkip={() => {}} />);
      expect(view.getByRole("status").textContent).toContain("Looking at this computer");
      await waitFor(() => expect(view.getByText("Keep the Mac awake")).toBeTruthy());
    } finally { h.restore(); }
  });

  test("an unsupported answer shows nothing to change and Skip still works", async () => {
    const h = stub({ supported: false, items: [] });
    try {
      const onSkip = mock(() => {});
      const view = render(<HostTuneStep onSkip={onSkip} />);
      await waitFor(() => expect(view.getByText("This computer needs no changes.")).toBeTruthy());
      fireEvent.click(view.getByText("Skip this step"));
      expect(onSkip).toHaveBeenCalledTimes(1);
    } finally { h.restore(); }
  });

  test("needs: groups by mode, Apply recommended applies every auto item, consent waits for its own click", async () => {
    const second = item({ id: "spotlight", title: "Pause Spotlight", mode: "auto" });
    const h = stub({ supported: true, items: [AUTO, second, CONSENT, ADVICE] }, {
      "/api/setup/host-tune/apply": (body) => ok({ item: { ...(body.id === "lowpower" ? AUTO : body.id === "spotlight" ? second : CONSENT), state: "applied" } }),
    });
    try {
      const view = render(<HostTuneStep onSkip={() => {}} />);
      await waitFor(() => expect(view.getByText("Recommended")).toBeTruthy());
      expect(view.getByText("Worth doing yourself")).toBeTruthy();
      expect(view.getByText("Now: 75%. After: 90%.")).toBeTruthy();
      expect(view.getAllByText("Apply recommended")).toHaveLength(1);
      expect(h.calls.some((call) => call.includes("/apply"))).toBe(false);
      fireEvent.click(view.getByText("Apply recommended"));
      await waitFor(() => expect(view.getAllByText("Applied.")).toHaveLength(2));
      expect(h.calls.filter((call) => call.startsWith("POST") && call.includes("/apply")).map((call) => call.split(" ").slice(-1)[0])).toEqual(['{"id":"lowpower"}', '{"id":"spotlight"}']);
      expect(view.queryByText("Apply recommended")).toBeNull();
      expect(view.getByText("Apply")).toBeTruthy();
    } finally { h.restore(); }
  });

  test("applied: a consent item shows what changed and a Revert that calls the revert route", async () => {
    const h = stub({ supported: true, items: [{ ...CONSENT, state: "applied" }] }, {
      "/api/setup/host-tune/revert": () => ok({ item: CONSENT }),
    });
    try {
      const view = render(<HostTuneStep onSkip={() => {}} />);
      await waitFor(() => expect(view.getByText("Changed. Now: 90%.")).toBeTruthy());
      fireEvent.click(view.getByText("Revert"));
      await waitFor(() => expect(view.getByText("Now: 75%. After: 90%.")).toBeTruthy());
      expect(h.calls.some((call) => call === 'POST /api/setup/host-tune/revert {"id":"wired"}')).toBe(true);
      expect(view.getByText("Apply")).toBeTruthy();
    } finally { h.restore(); }
  });

  test("apply failure says what went wrong with the route's next step, keeps the button, and Skip stays enabled", async () => {
    const h = stub({ supported: true, items: [CONSENT] }, {
      "/api/setup/host-tune/apply": () => new Response(JSON.stringify({ error: "macOS refused the change.", next: "Open System Settings, Privacy, and allow Terminal." }), { status: 403 }),
    });
    try {
      const onSkip = mock(() => {});
      const view = render(<HostTuneStep onSkip={onSkip} />);
      await waitFor(() => expect(view.getByText("Apply")).toBeTruthy());
      fireEvent.click(view.getByText("Apply"));
      await waitFor(() => expect(view.getByText(/macOS refused the change\. Open System Settings/)).toBeTruthy());
      expect(view.getByText("Apply")).toBeTruthy();
      fireEvent.click(view.getByText("Skip this step"));
      expect(onSkip).toHaveBeenCalledTimes(1);
    } finally { h.restore(); }
  });

  test("a failed load offers Try again and Skip", async () => {
    let fail = true;
    const h = stub({ supported: true, items: [AUTO] });
    const real = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => fail ? new Response(JSON.stringify({ error: "down" }), { status: 500 }) : real(input, init)) as unknown as typeof fetch;
    try {
      const view = render(<HostTuneStep onSkip={() => {}} />);
      await waitFor(() => expect(view.getByText(/Home couldn't read this computer's tuning options/)).toBeTruthy());
      expect(view.getByText("Skip this step")).toBeTruthy();
      fail = false;
      fireEvent.click(view.getByText("Try again"));
      await waitFor(() => expect(view.getByText("Keep the Mac awake")).toBeTruthy());
    } finally { globalThis.fetch = real; h.restore(); }
  });
});

describe("hostTuneFailure and useHostTuneSupported", () => {
  test("a plain error still names the next step", () => {
    expect(hostTuneFailure(new Error("boom"))).toContain("Try again, or skip this step");
    expect(hostTuneFailure(new ApiError("Nope.", 500))).toBe("Nope. Try again, or skip this step. Home works without it.");
  });

  test("the step is shown only when supported, and an unreadable answer counts as not supported", async () => {
    const yes = stub({ supported: true, items: [] });
    try {
      const { result } = renderHook(() => useHostTuneSupported(true));
      await waitFor(() => expect(result.current).toBe(true));
      const off = renderHook(() => useHostTuneSupported(false));
      expect(off.result.current).toBe(false);
    } finally { yes.restore(); }
    const no = stub(new Response("{}", { status: 500 }));
    try {
      const { result } = renderHook(() => useHostTuneSupported(true));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(result.current).toBe(false);
    } finally { no.restore(); }
  });
});
