import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { CloseAppsSettings } from "@/apps/settings/CloseAppsSettings";
import { CloseAppsStep, useCloseAppsQuestion } from "@/apps/setup/CloseAppsStep";

setDefaultTimeout(20_000);
const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

type Install = { result: string; message: string };
/** A fake hub: the helper starts not installed (or never installs, per `install`), and a successful install flips it on. */
function fakeHub(opts: { canInstall: boolean; install: Install; installedAtStart?: boolean; testResult?: "ok" | "not_allowed" }) {
  const state = { installed: opts.installedAtStart === true, installCalls: 0, puts: [] as string[] };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    const apps = state.installed ? [{ bundleId: "com.apple.Safari", name: "Safari", bytes: 1, frontmost: false }] : [];
    if (path.endsWith("/install")) { state.installCalls++; if (opts.install.result === "installed") state.installed = true; return Promise.resolve(Response.json(opts.install)); }
    if (path.endsWith("/api/performance/apps")) return Promise.resolve(Response.json({ installed: state.installed, can_install: opts.canInstall, apps }));
    if (path.endsWith("/api/setup/close-apps/test")) return Promise.resolve(Response.json({ result: opts.testResult ?? "ok" }));
    if (path.endsWith("/api/setup/close-apps")) return Promise.resolve(Response.json({ installed: state.installed, can_install: opts.canInstall, apps: apps.map(({ bundleId, name }) => ({ bundleId, name })) }));
    if (path.endsWith("/api/settings") && init?.method === "PUT") { state.puts.push(JSON.parse(String(init.body)).key); return Promise.resolve(Response.json({})); }
    if (path.endsWith("/api/settings")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;
  return state;
}
const card = () => renderWithQueryClient(<CloseAppsSettings value={() => undefined} write={async () => {}} />);

describe("Close apps card, helper states", () => {
  test("not installed: a plain status row with an Install helper button, and installing flips the row away", async () => {
    const hub = fakeHub({ canInstall: true, install: { result: "installed", message: "ok" } });
    const view = card();
    const row = await view.findByTestId("helper-status");
    expect(row.textContent).toContain("Helper not installed");
    fireEvent.click(view.getByText("Install helper"));
    for (let i = 0; i < 100 && view.queryByTestId("helper-status"); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.queryByTestId("helper-status")).toBeNull();
    expect(hub.installCalls).toBe(1);
  });
  test("a refused or failed install keeps the row and says what to do", async () => {
    fakeHub({ canInstall: true, install: { result: "no_toolchain", message: "Home needs Apple's Command Line Tools. Run xcode-select --install, then press Install helper again." } });
    const view = card();
    fireEvent.click(await view.findByText("Install helper"));
    expect(await view.findByText(/xcode-select --install/)).toBeTruthy();
    expect(view.getByTestId("helper-status")).toBeTruthy();
  });
  test("installed: no status row", async () => {
    fakeHub({ canInstall: true, install: { result: "installed", message: "" }, installedAtStart: true });
    const view = card();
    await view.findByTestId("close-apps-card");
    await waitFor(() => expect(view.queryByTestId("helper-status")).toBeNull());
  });
  test("a hub that cannot install says why and offers no button", async () => {
    fakeHub({ canInstall: false, install: { result: "not_mac", message: "" } });
    const view = card();
    expect((await view.findByTestId("helper-status")).textContent).toContain("only when Home runs on a Mac");
    expect(view.queryByText("Install helper")).toBeNull();
  });
});

describe("wizard Close apps question, helper states", () => {
  function Probe({ onShown }: { onShown: (shown: boolean) => void }) { onShown(useCloseAppsQuestion(true)); return null; }
  test("the question is shown while the helper is not installed on a Mac that can install it", async () => {
    fakeHub({ canInstall: true, install: { result: "installed", message: "" } });
    let shown = false;
    renderWithQueryClient(<Probe onShown={(v) => { shown = v; }} />);
    await waitFor(() => expect(shown).toBe(true));
  });
  test("and skipped when this computer cannot install it", async () => {
    fakeHub({ canInstall: false, install: { result: "not_mac", message: "" } });
    let shown = true;
    renderWithQueryClient(<Probe onShown={(v) => { shown = v; }} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown).toBe(false);
  });
  test("not installed: the step shows the status row; Install helper then leads to the normal question", async () => {
    const hub = fakeHub({ canInstall: true, install: { result: "installed", message: "ok" } });
    const view = renderWithQueryClient(<CloseAppsStep onDone={() => {}} />);
    expect((await view.findByTestId("helper-status")).textContent).toContain("Helper not installed");
    fireEvent.click(view.getByText("Install helper"));
    await view.findByLabelText("Automatic");
    expect(hub.installCalls).toBe(1);
  });
  test("Not now moves on without installing anything", async () => {
    const hub = fakeHub({ canInstall: true, install: { result: "installed", message: "" } });
    let done = false;
    const view = renderWithQueryClient(<CloseAppsStep onDone={() => { done = true; }} />);
    fireEvent.click(await view.findByText("Not now"));
    expect(done).toBe(true);
    expect(hub.installCalls).toBe(0);
  });
  test("installed but the permission test is refused: Close apps stays Off with a plain line", async () => {
    const hub = fakeHub({ canInstall: true, install: { result: "installed", message: "" }, installedAtStart: true, testResult: "not_allowed" });
    const view = renderWithQueryClient(<CloseAppsStep onDone={() => {}} />);
    fireEvent.click(await view.findByLabelText("Automatic"));
    await view.findByText(/Safari\./);
    fireEvent.click(view.getByText("Turn on Automatic"));
    expect(await view.findByText(/stays Off/)).toBeTruthy();
    expect(hub.puts).toEqual([]);
  });
});
