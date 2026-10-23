// SEARXNG-SET-05: the Web search settings block. Save gating, clearing, the status line, and the DuckDuckGo-only controls.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { WebSearchSettings, webSearchStatusLine } from "./WebSearchSettings";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { makePerson, mockHome } from "@/shell/pages/settings/settingsTestKit";
import type { WebSearchState } from "@/lib/api";
import type { SearchTestResultData } from "@/shell/components/searchTestResult";

afterEach(cleanup);

const PASS: SearchTestResultData = { level: "pass", address: "searx.local:8888", headline: "searx.local:8888 works. 12 search engines are turned on.", verdict: "Every check passed.", recommendation: "Recommended: use it.", canUse: true, trouble: [], details: [{ id: "reachability", title: "MaiPai can reach your search service", state: "pass", detail: "SearXNG answered its health check.", fix: null }] };
const WARN: SearchTestResultData = { ...PASS, level: "warn", headline: "searx.local:8888 works, with a warning.", recommendation: "Recommended: use it anyway." };
const FAIL: SearchTestResultData = { ...PASS, level: "fail", canUse: false, headline: "Home could not reach searx.local:8888.", verdict: "Nothing answered at that address.", recommendation: "Recommended: check the address and that SearXNG is running, then press Test again.", details: [] };

const BASE: WebSearchState = { address: "", works: null, stackOwned: false, sources: ["searxng"], ddgsReady: false };

function setup(state: Partial<WebSearchState> = {}, props: Partial<React.ComponentProps<typeof WebSearchSettings>> = {}) {
  const test_ = mock(async (_url: string) => ({ saved: false, result: PASS }));
  const save = mock(async (_url: string) => ({ saved: true }));
  const setSources = mock(async (_s: ("searxng" | "ddgs")[]) => ({}));
  const view = renderWithQueryClient(<WebSearchSettings load={async () => ({ ...BASE, ...state })} test={test_} save={save} setSources={setSources} minorsControl={<p>minors-control</p>} {...props} />);
  return { view, test: test_, save, setSources };
}
const field = (view: ReturnType<typeof setup>["view"]) => view.getByLabelText("SearXNG address") as HTMLInputElement;
const type = (view: ReturnType<typeof setup>["view"], value: string) => fireEvent.change(field(view), { target: { value } });
const press = async (view: ReturnType<typeof setup>["view"], name: string) => { await act(async () => { fireEvent.click(view.getByRole("button", { name })); }); };
const disabled = (view: ReturnType<typeof setup>["view"], name: string) => view.getByRole("button", { name }).hasAttribute("disabled");

describe("status line", () => {
  test("says in plain words what search uses", () => {
    expect(webSearchStatusLine({ ...BASE, address: "http://192.0.2.10:8888", works: true })).toBe("SearXNG at 192.0.2.10:8888 works");
    expect(webSearchStatusLine({ ...BASE, address: "http://192.0.2.10:8888", works: false })).toBe("SearXNG at 192.0.2.10:8888 is not answering");
    expect(webSearchStatusLine({ ...BASE, sources: ["ddgs"], ddgsReady: true })).toBe("DuckDuckGo (adults only)");
    expect(webSearchStatusLine({ ...BASE, address: "http://192.0.2.10:8888", works: true, sources: ["searxng", "ddgs"], ddgsReady: true })).toBe("SearXNG at 192.0.2.10:8888 works, and DuckDuckGo (adults only)");
    expect(webSearchStatusLine(BASE)).toBe("Library only");
    expect(webSearchStatusLine({ ...BASE, sources: ["searxng", "ddgs"], ddgsReady: false })).toBe("Library only");
    expect(webSearchStatusLine({ ...BASE, stackOwned: true })).toBe("Home's own search service");
  });
});

describe("Save gating", () => {
  test("shows the status line and the reason to run SearXNG", async () => {
    const { view } = setup({ address: "http://192.0.2.10:8888", works: true });
    await waitFor(() => expect(view.getByTestId("web-search-status").textContent).toBe("SearXNG at 192.0.2.10:8888 works"));
    expect(view.container.textContent).toContain("private, keeps no record of who asked, and searches many sites at once");
    expect(field(view).value).toBe("http://192.0.2.10:8888");
  });

  test("an empty field with nothing saved: Save and Test are off", async () => {
    const { view } = setup();
    await waitFor(() => view.getByLabelText("SearXNG address"));
    expect(disabled(view, "Save")).toBe(true);
    expect(disabled(view, "Test")).toBe(true);
  });

  test("text without a Test keeps Save off; a passing Test turns it on; Save sends the text", async () => {
    const { view, test, save } = setup();
    await waitFor(() => view.getByLabelText("SearXNG address"));
    type(view, "http://searx.local:8888");
    expect(disabled(view, "Save")).toBe(true);
    await press(view, "Test");
    expect(test).toHaveBeenCalledWith("http://searx.local:8888");
    expect(view.container.textContent).toContain("searx.local:8888 works. 12 search engines are turned on.");
    expect(view.container.textContent).toContain("Recommended: use it.");
    expect(disabled(view, "Save")).toBe(false);
    await press(view, "Save");
    expect(save).toHaveBeenCalledWith("http://searx.local:8888");
  });

  test("a warning counts as a pass", async () => {
    const { view } = setup({}, { test: async () => ({ saved: false, result: WARN }) });
    await waitFor(() => view.getByLabelText("SearXNG address"));
    type(view, "http://searx.local:8888");
    await press(view, "Test");
    expect(disabled(view, "Save")).toBe(false);
  });

  test("editing after a pass turns Save off again with the one-line reason", async () => {
    const { view } = setup();
    await waitFor(() => view.getByLabelText("SearXNG address"));
    type(view, "http://searx.local:8888");
    await press(view, "Test");
    type(view, "http://searx.local:8889");
    expect(disabled(view, "Save")).toBe(true);
    expect(view.container.textContent).toContain("You changed the address. Test it again, or clear it.");
    expect(view.queryByText("searx.local:8888 works. 12 search engines are turned on.")).toBeNull();
  });

  test("a failed Test keeps Save off and shows the failure as the destructive alert", async () => {
    const { view } = setup({}, { test: async () => ({ saved: false, result: FAIL }) });
    await waitFor(() => view.getByLabelText("SearXNG address"));
    type(view, "http://searx.local:8888");
    await press(view, "Test");
    expect(disabled(view, "Save")).toBe(true);
    expect(view.container.querySelector('[data-level="fail"]')).not.toBeNull();
    expect(view.container.textContent).toContain("Home could not reach searx.local:8888.");
  });
});

describe("clearing", () => {
  test("clearing a saved address offers Remove SearXNG, asks first, then saves the empty text", async () => {
    const { view, save } = setup({ address: "http://192.0.2.10:8888", works: true });
    await waitFor(() => view.getByLabelText("SearXNG address"));
    expect(disabled(view, "Save")).toBe(true);
    type(view, "");
    await press(view, "Remove SearXNG");
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Home will use the Library only until you add a SearXNG address.");
    const confirm = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === "Remove SearXNG").pop()!;
    await act(async () => { fireEvent.click(confirm); });
    expect(save).toHaveBeenCalledWith("");
  });

  test("with DuckDuckGo on, the confirmation says what happens to adults, teens and children", async () => {
    const { view } = setup({ address: "http://192.0.2.10:8888", works: true, sources: ["searxng", "ddgs"], ddgsReady: true });
    await waitFor(() => view.getByLabelText("SearXNG address"));
    type(view, "");
    await press(view, "Remove SearXNG");
    expect(document.body.textContent).toContain("Home will use DuckDuckGo for adults and the Library only for teens and children.");
  });
});

describe("DuckDuckGo controls", () => {
  test("without the helper: no source switches and no teen choice", async () => {
    const { view } = setup();
    await waitFor(() => view.getByLabelText("SearXNG address"));
    expect(view.queryByLabelText("Use DuckDuckGo")).toBeNull();
    expect(view.queryByText("minors-control")).toBeNull();
  });

  test("with the helper: both switches, the adults-only note and the teen choice; the last source cannot be turned off", async () => {
    const { view, setSources } = setup({ ddgsReady: true, sources: ["searxng"] });
    await waitFor(() => view.getByLabelText("Use DuckDuckGo"));
    expect(view.getByText("minors-control")).toBeTruthy();
    expect(view.container.textContent).toContain("Adults only.");
    expect(view.getByLabelText("Use SearXNG").hasAttribute("data-disabled")).toBe(true);
    await act(async () => { fireEvent.click(view.getByLabelText("Use DuckDuckGo")); });
    expect(setSources).toHaveBeenCalledWith(["searxng", "ddgs"]);
  });
});

describe("who sees it", () => {
  function open(role: "owner" | "admin" | "adult" | "teen" | "child") {
    const fixture = mockHome();
    const base = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (path.endsWith("/api/search/web")) return Promise.resolve(Response.json({ ...BASE, address: "http://192.0.2.10:8888", works: true }));
      return base(input, init);
    }) as typeof fetch;
    const view = renderWithQueryClient(
      <MemoryRouter initialEntries={["/settings/search?tab=search"]}>
        <Routes><Route path="settings/:section?/:detailId?" element={<SettingsAreaPage person={makePerson(role)} onPersonChange={() => {}} />} /></Routes>
      </MemoryRouter>,
    );
    return { view, restore: () => { globalThis.fetch = base; fixture.restore(); } };
  }

  test.each(["owner", "admin"] as const)("an %s sees the Web search block under Home settings, Search", async (role) => {
    const { view, restore } = open(role);
    try { await waitFor(() => expect(view.getByTestId("web-search-status").textContent).toBe("SearXNG at 192.0.2.10:8888 works")); }
    finally { restore(); }
  });

  test.each(["adult", "teen", "child"] as const)("a %s never sees it", async (role) => {
    const { view, restore } = open(role);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(view.queryByTestId("web-search-status")).toBeNull();
      expect(view.queryByLabelText("SearXNG address")).toBeNull();
    } finally { restore(); }
  });
});
