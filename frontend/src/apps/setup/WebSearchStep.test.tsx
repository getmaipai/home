import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { WebSearchStep } from "./WebSearchStep";

afterEach(cleanup);

const type = (rendered: ReturnType<typeof render>, value: string) => fireEvent.change(rendered.getByLabelText(/SearXNG address/), { target: { value } });
const press = async (rendered: ReturnType<typeof render>, name: string) => { await act(async () => { fireEvent.click(rendered.getByRole("button", { name })); }); };

describe("WebSearchStep", () => {
  test("shows the value in two sentences, an address field, Test, Save and Skip for now", () => {
    const rendered = render(<WebSearchStep onFinished={() => {}} />);
    expect(rendered.container.textContent).toContain("keeps no record of who asked");
    expect(rendered.getByLabelText(/SearXNG address/)).toBeTruthy();
    for (const name of ["Test", "Save", "Skip for now"]) expect(rendered.getByRole("button", { name })).toBeTruthy();
    expect(rendered.getByRole("button", { name: "Test" }).hasAttribute("disabled")).toBe(true);
    expect(rendered.container.textContent).toContain("Skipping turns on DuckDuckGo search for adults");
  });

  test("Test saves nothing and says it works; Save saves and goes on", async () => {
    const test_ = mock(async () => ({ saved: false }));
    const save = mock(async () => ({ saved: true }));
    const done = mock(() => {});
    const rendered = render(<WebSearchStep onFinished={done} test={test_} save={save} />);
    type(rendered, " http://searx.local:8888 ");
    await press(rendered, "Test");
    expect(test_).toHaveBeenCalledWith("http://searx.local:8888");
    await waitFor(() => expect(rendered.container.textContent).toContain("That works"));
    expect(save).not.toHaveBeenCalled();
    await press(rendered, "Save");
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
