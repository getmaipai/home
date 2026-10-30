import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { CloseAppsStep, openStarterApps } from "@/apps/setup/CloseAppsStep";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

function serve(testResult: "ok" | "not_allowed") {
  const puts: { key: string; value: unknown }[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    if (path.endsWith("/api/setup/close-apps/test")) return Promise.resolve(Response.json({ result: testResult }));
    if (path.endsWith("/api/setup/close-apps")) return Promise.resolve(Response.json({ installed: true, apps: [{ bundleId: "com.apple.Safari", name: "Safari" }, { bundleId: "com.apple.Terminal", name: "Terminal" }] }));
    if (path.endsWith("/api/settings") && init?.method === "PUT") { const body = JSON.parse(String(init.body)); puts.push({ key: body.key, value: body.value }); return Promise.resolve(Response.json({ key: body.key, value: body.value })); }
    if (path.endsWith("/api/settings")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
  return puts;
}

describe("openStarterApps", () => {
  test("only starter apps that are open count, and no helper means none", () => {
    expect(openStarterApps({ installed: true, apps: [{ bundleId: "com.apple.Safari", name: "Safari" }, { bundleId: "com.apple.Terminal", name: "Terminal" }] }).map((a) => a.name)).toEqual(["Safari"]);
    expect(openStarterApps({ installed: false, apps: [{ bundleId: "com.apple.Safari", name: "Safari" }] })).toEqual([]);
  });
});

describe("CloseAppsStep", () => {
  test("Automatic lists the open starter apps, passes the test, then writes the list and the mode", async () => {
    const puts = serve("ok");
    let done = false;
    const view = renderWithQueryClient(<CloseAppsStep onDone={() => { done = true; }} />);
    fireEvent.click(await view.findByLabelText("Automatic"));
    await view.findByText(/Safari\./);
    fireEvent.click(view.getByText("Turn on Automatic"));
    await waitFor(() => expect(done).toBe(true));
    expect(puts.map((p) => p.key)).toEqual(["resources.close_apps.always", "resources.close_apps.mode"]);
    expect(puts[0]!.value).toBe(JSON.stringify(["com.apple.Safari"]));
    expect(puts[1]!.value).toBe("automatic");
  });
  test("a refused test leaves the feature Off with a plain line", async () => {
    const puts = serve("not_allowed");
    let done = false;
    const view = renderWithQueryClient(<CloseAppsStep onDone={() => { done = true; }} />);
    fireEvent.click(await view.findByLabelText("Automatic"));
    await view.findByText(/Safari\./);
    fireEvent.click(view.getByText("Turn on Automatic"));
    expect(await view.findByText(/stays Off/)).toBeTruthy();
    expect(puts).toEqual([]);
    expect(done).toBe(false);
  });
});
