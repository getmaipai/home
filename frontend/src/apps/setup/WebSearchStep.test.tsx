import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { WebSearchStep } from "./WebSearchStep";
import type { SearchTestResultData } from "@/shell/components/searchTestResult";

afterEach(cleanup);

const type = (rendered: ReturnType<typeof render>, value: string) => fireEvent.change(rendered.getByLabelText(/SearXNG address/), { target: { value } });
const press = async (rendered: ReturnType<typeof render>, name: string) => { await act(async () => { fireEvent.click(rendered.getByRole("button", { name })); }); };

const PASS: SearchTestResultData = { level: "pass", address: "searx.local:8888", headline: "searx.local:8888 works. 12 search engines are turned on.", verdict: "Every check passed.", recommendation: "Recommended: use it.", canUse: true, trouble: [], details: [{ id: "reachability", title: "MaiPai can reach your search service", state: "pass", detail: "SearXNG answered its health check.", fix: null }] };
const WARN: SearchTestResultData = { ...PASS, level: "warn", headline: "searx.local:8888 works, with a warning.", verdict: "Google and Bing are not answering right now. Results may be thinner.", recommendation: "Recommended: use it anyway, or turn those engines off in SearXNG's settings under Preferences, Engines, then Test again.", trouble: [{ label: "Google", important: true }, { label: "Bing", important: true }] };
const FAIL: SearchTestResultData = { ...PASS, level: "fail", canUse: false, headline: "Home could not reach searx.local:8888.", verdict: "Nothing answered at that address.", recommendation: "Recommended: check the address and that SearXNG is running, then press Test again.", details: [] };

describe("WebSearchStep", () => {
  test("a warning names the engines, recommends, offers Save and use it, and hides the check rows behind Details", async () => {
    const rendered = render(<WebSearchStep onFinished={() => {}} test={async () => ({ saved: false, result: WARN })} />);
    type(rendered, "http://searx.local:8888");
    await press(rendered, "Test");
    await waitFor(() => expect(rendered.container.textContent).toContain("Google and Bing are not answering right now"));
    expect(rendered.container.textContent).toContain("Recommended: use it anyway");
    expect(rendered.container.textContent).not.toContain("Check whether these engines");
    expect(rendered.container.textContent).not.toContain("SearXNG answered its health check.");
    expect(rendered.getByRole("button", { name: "Save and use it" })).toBeTruthy();
    await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Details" })); });
    expect(rendered.container.textContent).toContain("SearXNG answered its health check.");
  });

  test("a failed test names the address, recommends, and offers Try again but no Save", async () => {
    const rendered = render(<WebSearchStep onFinished={() => {}} test={async () => ({ saved: false, result: FAIL })} />);
    type(rendered, "http://searx.local:8888");
    await press(rendered, "Test");
    await waitFor(() => expect(rendered.container.textContent).toContain("Home could not reach searx.local:8888."));
    expect(rendered.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(rendered.queryByRole("button", { name: /^Save/ })).toBeNull();
    expect(rendered.getByRole("button", { name: "Skip for now" })).toBeTruthy();
  });

  test("shows the value in two sentences, an address field, Test, Save and Skip for now", () => {
    const rendered = render(<WebSearchStep onFinished={() => {}} />);
    expect(rendered.container.textContent).toContain("keeps no record of who asked");
    expect(rendered.getByLabelText(/SearXNG address/)).toBeTruthy();
    for (const name of ["Test", "Save", "Skip for now"]) expect(rendered.getByRole("button", { name })).toBeTruthy();
    expect(rendered.getByRole("button", { name: "Test" }).hasAttribute("disabled")).toBe(true);
    expect(rendered.container.textContent).toContain("Skipping turns on DuckDuckGo search for adults");
  });

  test("Test saves nothing and says it works; Save saves and goes on", async () => {
    const test_ = mock(async () => ({ saved: false, result: PASS }));
    const save = mock(async () => ({ saved: true }));
    const done = mock(() => {});
    const rendered = render(<WebSearchStep onFinished={done} test={test_} save={save} />);
    type(rendered, " http://searx.local:8888 ");
    await press(rendered, "Test");
    expect(test_).toHaveBeenCalledWith("http://searx.local:8888");
    await waitFor(() => expect(rendered.container.textContent).toContain("searx.local:8888 works. 12 search engines are turned on."));
    expect(rendered.container.textContent).toContain("Recommended: use it.");
    expect(save).not.toHaveBeenCalled();
    await press(rendered, "Save and use it");
    expect(save).toHaveBeenCalledWith("http://searx.local:8888");
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });

  test("a bad address shows the checker's line and the next step, and does not go on", async () => {
    const done = mock(() => {});
    const rendered = render(<WebSearchStep onFinished={done} test={async () => { throw new ApiError("Use a search service on your home network.", 400, undefined, "Type an address like http://searx.local:8888."); }} />);
    type(rendered, "http://example.com");
    await press(rendered, "Test");
    await waitFor(() => expect(rendered.getByRole("alert").textContent).toBe("Use a search service on your home network. Type an address like http://searx.local:8888."));
    const alert = rendered.getByRole("alert");
    expect(alert.getAttribute("data-slot")).toBe("alert");
    expect(alert.className).toContain("text-destructive");
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(done).not.toHaveBeenCalled();
  });

  test("a found instance is filled in", () => {
    const rendered = render(<WebSearchStep candidate="http://127.0.0.1:8888" onFinished={() => {}} />);
    expect((rendered.getByLabelText(/SearXNG address/) as HTMLInputElement).value).toBe("http://127.0.0.1:8888");
  });

  test("Skip for now, and the wizard's Continue, turn DuckDuckGo on and go on; a failed skip says what to do and the next press goes on", async () => {
    const skip = mock(async () => ({ saved: true }));
    const done = mock(() => {});
    const continueRef = { current: null as (() => Promise<void>) | null };
    const rendered = render(<WebSearchStep onFinished={done} skip={skip} continueRef={continueRef} />);
    await act(async () => { await continueRef.current!(); });
    expect(skip).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    rendered.unmount();
    const failing = mock(async () => { throw new Error("down"); });
    const again = mock(() => {});
    const second = render(<WebSearchStep onFinished={again} skip={failing} />);
    await press(second, "Skip for now");
    await waitFor(() => expect(second.getByRole("alert").textContent).toContain("set up web search later in Settings"));
    expect(again).not.toHaveBeenCalled();
    await press(second, "Skip for now");
    expect(again).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
