import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { WebSearchStep } from "./WebSearchStep";
import type { SearchTestResultData } from "@/shell/components/searchTestResult";

afterEach(cleanup);

const type = (rendered: ReturnType<typeof render>, value: string) => fireEvent.change(rendered.getByLabelText(/SearXNG address/), { target: { value } });
const gate = () => { const g = { can: true, ref: { current: null as (() => Promise<void>) | null } }; return g; };
const press = async (rendered: ReturnType<typeof render>, name: string) => { await act(async () => { fireEvent.click(rendered.getByRole("button", { name })); }); };

const PASS: SearchTestResultData = { level: "pass", address: "searx.local:8888", headline: "searx.local:8888 works. 12 search engines are turned on.", verdict: "Every check passed.", recommendation: "Recommended: use it.", canUse: true, trouble: [], details: [{ id: "reachability", title: "MaiPai can reach your search service", state: "pass", detail: "SearXNG answered its health check.", fix: null }] };
const WARN: SearchTestResultData = { ...PASS, level: "warn", headline: "searx.local:8888 works, with a warning.", verdict: "Google and Bing are not answering right now. Results may be thinner.", recommendation: "Recommended: use it anyway, or turn those engines off in SearXNG's settings under Preferences, Engines, then Test again.", trouble: [{ label: "Google", important: true }, { label: "Bing", important: true }] };
const FAIL: SearchTestResultData = { ...PASS, level: "fail", canUse: false, headline: "Home could not reach searx.local:8888.", verdict: "Nothing answered at that address.", recommendation: "Recommended: check the address and that SearXNG is running, then press Test again.", details: [] };

describe("WebSearchStep", () => {
  function setup(props: Partial<React.ComponentProps<typeof WebSearchStep>> = {}) {
    const g = gate();
    const done = mock(() => {});
    const rendered = render(<WebSearchStep onFinished={done} continueRef={g.ref} onCanContinue={(can) => { g.can = can; }} {...props} />);
    return { g, done, rendered };
  }
  const pressContinue = async (g: ReturnType<typeof gate>) => { await act(async () => { await g.ref.current!(); }); };

  test("an empty field enables Continue, whitespace counts as empty, and Continue skips: DuckDuckGo on, nothing saved", async () => {
    const skip = mock(async () => ({ saved: true }));
    const save = mock(async () => ({ saved: true }));
    const { g, done, rendered } = setup({ skip, save });
    expect(g.can).toBe(true);
    type(rendered, "   ");
    expect(g.can).toBe(true);
    expect(rendered.getByRole("button", { name: "Test" }).hasAttribute("disabled")).toBe(true);
    await pressContinue(g);
    expect(skip).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
    expect(rendered.container.textContent).toContain("leave the address empty and press Continue");
    expect(rendered.queryByRole("button", { name: /Skip|Save/ })).toBeNull();
  });

  test("text without a passing Test keeps Continue disabled", async () => {
    const { g, rendered } = setup();
    type(rendered, "http://searx.local:8888");
    expect(g.can).toBe(false);
    expect(rendered.getByRole("button", { name: "Test" }).hasAttribute("disabled")).toBe(false);
  });

  test("a passing Test enables Continue; Continue saves the tested text and goes on", async () => {
    const test_ = mock(async () => ({ saved: false, result: PASS }));
    const save = mock(async () => ({ saved: true }));
    const { g, done, rendered } = setup({ test: test_, save });
    type(rendered, " http://searx.local:8888 ");
    await press(rendered, "Test");
    expect(test_).toHaveBeenCalledWith("http://searx.local:8888");
    await waitFor(() => expect(g.can).toBe(true));
    expect(rendered.container.textContent).toContain("searx.local:8888 works. 12 search engines are turned on.");
    expect(rendered.container.textContent).toContain("Recommended: use it.");
    expect(save).not.toHaveBeenCalled();
    await pressContinue(g);
    expect(save).toHaveBeenCalledWith("http://searx.local:8888");
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("a warning counts as passed, names the engines, and hides the check rows behind Details", async () => {
    const { g, rendered } = setup({ test: async () => ({ saved: false, result: WARN }) });
    type(rendered, "http://searx.local:8888");
    await press(rendered, "Test");
    await waitFor(() => expect(rendered.container.textContent).toContain("Google and Bing are not answering right now"));
    expect(g.can).toBe(true);
    expect(rendered.container.textContent).toContain("Recommended: use it anyway");
    expect(rendered.container.textContent).not.toContain("Check whether these engines");
    expect(rendered.container.textContent).not.toContain("SearXNG answered its health check.");
    await act(async () => { fireEvent.click(rendered.getByRole("button", { name: "Details" })); });
    expect(rendered.container.textContent).toContain("SearXNG answered its health check.");
  });

  test("editing after a pass disables Continue and says what to do; testing again or clearing fixes it", async () => {
    const { g, rendered } = setup({ test: async () => ({ saved: false, result: PASS }) });
    type(rendered, "http://searx.local:8888");
    await press(rendered, "Test");
    await waitFor(() => expect(g.can).toBe(true));
    type(rendered, "http://searx.local:8889");
    expect(g.can).toBe(false);
    expect(rendered.container.textContent).toContain("You changed the address. Test it again, or clear it to skip.");
    await press(rendered, "Test");
    await waitFor(() => expect(g.can).toBe(true));
    expect(rendered.container.textContent).not.toContain("You changed the address");
    type(rendered, "http://other.local:1");
    expect(g.can).toBe(false);
    type(rendered, "");
    expect(g.can).toBe(true);
  });

  test("a failed test names the address, recommends, offers Try again, and keeps Continue disabled", async () => {
    const { g, rendered } = setup({ test: async () => ({ saved: false, result: FAIL }) });
    type(rendered, "http://searx.local:8888");
    await press(rendered, "Test");
    await waitFor(() => expect(rendered.container.textContent).toContain("Home could not reach searx.local:8888."));
    expect(g.can).toBe(false);
    expect(rendered.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("Continue is disabled while a test is running", async () => {
    let release!: (value: { saved: boolean; result: SearchTestResultData }) => void;
    const { g, rendered } = setup({ test: () => new Promise((resolve) => { release = resolve; }) });
    type(rendered, "http://searx.local:8888");
    await press(rendered, "Test");
    expect(g.can).toBe(false);
    await act(async () => { release({ saved: false, result: PASS }); });
    await waitFor(() => expect(g.can).toBe(true));
  });

  test("a save that fails shows the error and stays on the screen", async () => {
    const save = mock(async () => { throw new ApiError("Home is already set up. Sign in instead.", 400); });
    const { g, done, rendered } = setup({ test: async () => ({ saved: false, result: PASS }), save });
    type(rendered, "http://searx.local:8888");
    await press(rendered, "Test");
    await waitFor(() => expect(g.can).toBe(true));
    await pressContinue(g);
    await waitFor(() => expect(rendered.getByRole("alert").textContent).toContain("Home is already set up"));
    expect(done).not.toHaveBeenCalled();
  });

  test("a bad address shows the checker's line and the next step, and does not go on", async () => {
    const { g, done, rendered } = setup({ test: async () => { throw new ApiError("Use a search service on your home network.", 400, undefined, "Type an address like http://searx.local:8888."); } });
    type(rendered, "http://example.com");
    await press(rendered, "Test");
    await waitFor(() => expect(rendered.getByRole("alert").textContent).toBe("Use a search service on your home network. Type an address like http://searx.local:8888."));
    expect(g.can).toBe(false);
    expect(done).not.toHaveBeenCalled();
  });

  test("a found instance is filled in but still needs a Test", () => {
    const { g, rendered } = setup({ candidate: "http://127.0.0.1:8888" });
    expect((rendered.getByLabelText(/SearXNG address/) as HTMLInputElement).value).toBe("http://127.0.0.1:8888");
    expect(g.can).toBe(false);
  });

  test("a failed skip says what to do and the next Continue goes on", async () => {
    const failing = mock(async () => { throw new Error("down"); });
    const { g, done, rendered } = setup({ skip: failing });
    await pressContinue(g);
    await waitFor(() => expect(rendered.getByRole("alert").textContent).toContain("set up web search later in Settings"));
    expect(done).not.toHaveBeenCalled();
    await pressContinue(g);
    expect(done).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
