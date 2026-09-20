import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { InstalledPackage, Roster, StoreInstall } from "@/lib/api";
import { AppsPage } from "./AppsPage";

afterEach(cleanup);

// DetailsPane.test.tsx's own precedent: a Radix Sheet/Dialog portal
// outlives testing-library's own container, and this environment's
// waitFor (MutationObserver-based) stops reliably noticing DOM changes
// once a few Sheets have mounted and unmounted in the same file (this
// one renders several across its tests). A short real delay settles
// Radix's own effects just as reliably and doesn't depend on that
// observer.
function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePerson(role: Roster["role"] = "owner"): Roster {
  return {
    id: "person-jesse123",
    display_name: "jesse",
    nickname: null,
    role,
    avatar_seed: "person-jesse123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

function makePackage(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id: "weather",
    version: "0.1.0",
    kind: "plugin",
    category: "Utilities",
    display: "Weather",
    description: "Reads the local forecast.",
    author: "MaiPai",
    license: "AGPL-3.0",
    homepage: "https://github.com/getmaipai/catalog",
    routing: { examples: ["what's the weather"], patterns: ["weather"] },
    args: { type: "object", required: [], properties: {} },
    requires: [],
    optional: [],
    platforms: ["home"],
    min_role: "child",
    consequential: false,
    offline: "full",
    config: [],
    data_sources: [],
    permissions: [],
    notifications: [],
    backup: "hot",
    background: false,
    contributes: {},
    min_app: "0.1.0",
    tier: 0,
    quality_scale: "bronze",
    installed_version: "0.1.0",
    latest_version: "0.1.0",
    channel: "stable",
    status: "enabled",
    smoke: { last_run_at: null, ok: true, message: null },
    ...overrides,
  } as InstalledPackage;
}

function stubFetch(options: { packages?: InstalledPackage[]; install?: StoreInstall | null; installStatus?: number; requestedUrls?: string[] }): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    options.requestedUrls?.push(url);
    if (url.includes("/api/store/installs/") && url.includes("/uninstall")) return Promise.resolve(Response.json({ ok: true }));
    if (url.includes("/api/store/installs/") && options.installStatus) return Promise.resolve(new Response("boom", { status: options.installStatus }));
    if (url.includes("/api/store/installs/")) return Promise.resolve(Response.json(options.install ?? null));
    if (url.includes("/api/plugins")) return Promise.resolve(Response.json(options.packages ?? []));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function renderPage(person: Roster = makePerson()) {
  return renderWithQueryClient(
    <ToastProvider>
      <MemoryRouter>
        <AppsPage person={person} />
      </MemoryRouter>
    </ToastProvider>,
  );
}

test("lists installed packages by name, category and type", async () => {
  const restore = stubFetch({ packages: [makePackage(), makePackage({ id: "joke", display: "Joke", category: "Fun", kind: "companion" })] });
  const view = renderPage();
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  expect(view.getByText("Joke")).toBeInTheDocument();
  expect(view.getAllByText("Plugin").length).toBeGreaterThan(0);
  expect(view.getAllByText("Companion").length).toBeGreaterThan(0);
  restore();
});

test("the category filter narrows the table to matching rows", async () => {
  const restore = stubFetch({ packages: [makePackage(), makePackage({ id: "joke", display: "Joke", category: "Fun", kind: "companion" })] });
  const view = renderPage();
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  fireEvent.click(view.getByRole("checkbox", { name: "Fun" }));
  await waitFor(() => expect(view.queryByText("Weather")).not.toBeInTheDocument());
  expect(view.getByText("Joke")).toBeInTheDocument();
  restore();
});

// Regression: the "From the catalog" filter used to have nothing behind
// it - the store index isn't wired up yet (docs/BACKLOG.md's own
// follow-up item), so selecting it must say that honestly instead of
// silently showing zero rows with no explanation, or worse, the
// installed rows it has nothing to do with.
test("the 'From the catalog' filter shows an honest empty state, not the installed rows", async () => {
  const restore = stubFetch({ packages: [makePackage()] });
  const view = renderPage();
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  fireEvent.click(view.getByRole("checkbox", { name: "From the catalog" }));
  await waitFor(() => expect(view.queryByText("Weather")).not.toBeInTheDocument());
  expect(view.getByText("Nothing here yet: the catalog isn't connected.")).toBeInTheDocument();
  restore();
});

test("selecting a row opens the pane with its status and permissions", async () => {
  const restore = stubFetch({ packages: [makePackage({ permissions: ["network"] })] });
  const view = renderPage();
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  fireEvent.click(view.getByText("Weather"));
  const pane = within(view.getByRole("complementary"));
  await waitFor(() => expect(pane.getByText("weather")).toBeInTheDocument());
  expect(pane.getByText("Ready")).toBeInTheDocument();
  expect(pane.getByText("network")).toBeInTheDocument();
  restore();
});

// Regression: a non-admin role could still reach the store's owner/admin
// routes with no gate at all (the same class of bug HOME-UI-01 found in
// useHubStatus) - Remove must read as disabled with a real reason, never
// silently attempt a call that only ever 403s.
test("a non-admin sees Remove disabled with the real reason, and never calls the store route", async () => {
  const requestedUrls: string[] = [];
  const restore = stubFetch({ packages: [makePackage()], requestedUrls });
  const view = renderPage(makePerson("adult"));
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  fireEvent.click(view.getByText("Weather"));
  const removeButton = await waitFor(() => view.getByRole("button", { name: "Remove" }));
  expect(removeButton).toBeDisabled();
  expect(removeButton.getAttribute("title")).toBe("Owners and admins only.");
  expect(requestedUrls.some((url) => url.includes("/api/store/installs/"))).toBe(false);
  restore();
});

test("an owner sees Remove disabled for a bundled package with no active store install", async () => {
  const restore = stubFetch({ packages: [makePackage()], install: null });
  const view = renderPage(makePerson("owner"));
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  fireEvent.click(view.getByText("Weather"));
  const removeButton = await waitFor(() => view.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(removeButton.getAttribute("title")).toBe("This ships with Home; nothing to remove."));
  expect(removeButton).toBeDisabled();
  restore();
});

// Regression: a failed check for whether a package has an active store
// install used to read identically to "confirmed nothing to remove"
// (both are `!installQuery.data`) - a real fetch failure must say so,
// not quietly claim the package can't be removed.
test("a failed active-install check disables Remove with its own reason, not the bundled-package one", async () => {
  const restore = stubFetch({ packages: [makePackage()], installStatus: 500 });
  const view = renderPage(makePerson("owner"));
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  fireEvent.click(view.getByText("Weather"));
  const removeButton = await waitFor(() => view.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(removeButton.getAttribute("title")).toBe("Couldn't check what's removable - try again."));
  expect(removeButton).toBeDisabled();
  restore();
});

test("an owner can remove a store-installed package after confirming", async () => {
  const install: StoreInstall = { id: "weather", version: "0.2.0", previousVersion: "0.1.0", channel: "stable", sourceCommit: "abc123", permissions: [], installedAt: "2026-09-20T00:00:00.000Z" };
  const requestedUrls: string[] = [];
  const restore = stubFetch({ packages: [makePackage()], install, requestedUrls });
  const view = renderPage(makePerson("owner"));
  await waitFor(() => expect(view.getByText("Weather")).toBeInTheDocument());
  fireEvent.click(view.getByText("Weather"));
  const removeButton = await waitFor(() => view.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(removeButton).not.toBeDisabled());
  fireEvent.click(removeButton);
  expect(view.getByText("Remove Weather? This uninstalls it from the hub.")).toBeInTheDocument();
  fireEvent.click(view.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(requestedUrls.some((url) => url.includes("/api/store/installs/weather/uninstall"))).toBe(true));
  await settle();
  // Not queryByRole("complementary")/toBeInTheDocument(): a Radix Sheet
  // portal can outlive testing-library's own container (DetailsPane.test.tsx's
  // own precedent), so a stale, disconnected node from an earlier
  // render can still surface in that query. document.body's own text is
  // the reliable signal that the pane's real content is gone.
  expect(document.body.textContent).not.toContain("Remove Weather? This uninstalls it from the hub.");
  expect(document.body.textContent).not.toContain("weather");
  restore();
});
