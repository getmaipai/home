import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SettingsPage } from "@/apps/settings/SettingsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster, SettingsKey, ResolvedSetting } from "@/lib/api";

afterEach(cleanup);

// A fresh QueryClient per render, not the app's module-level singleton:
// the registry query's `staleTime: Infinity` means a shared client would
// carry one test's cached registry into the next. Step 7's Household/Me
// tabs are URL-bound (`useSearchParams`), which throws outside a Router
// - wrapped here the same way ChatPage.test.tsx already wraps ChatPage.
function renderSettingsPage(props: Parameters<typeof SettingsPage>[0]) {
  // `/settings` explicitly, not MemoryRouter's own "/" default: SettingsPage
  // now compares `location.pathname` against the literal "/settings" path
  // to decide whether to show its own tab content or a nested route's
  // <Outlet/> (2026-09-06's rail/header/search-persistence fix) - it's
  // always actually mounted at that path in the real app (App.tsx).
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage {...props} />
    </MemoryRouter>,
  );
}

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

function makePerson(role: Roster["role"] = "child"): Roster {
  return {
    id: "person-abc123",
    display_name: "Bramble",
    nickname: null,
    role,
    avatar_seed: "person-abc123",
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

const REGISTRY: SettingsKey[] = [
  {
    key: "household.locale",
    scope: "household",
    selector: "select",
    range: { options: ["en-US", "en-GB"] },
    default: "en-US",
    label: "Language and region",
    level: "basic",
    secret: false,
    lives_in: "household.system",
    honoured_by: ["home"],
  },
  {
    key: "tts.voice_id",
    scope: "person",
    selector: "select",
    range: { options: ["alba", "vera"] },
    default: "alba",
    label: "Speaking voice",
    level: "basic",
    secret: false,
    lives_in: "person.voice",
    honoured_by: ["home"],
  },
];

function resolved(key: string, value: unknown, label: string): ResolvedSetting {
  return { key, value, source: "default", label, level: "basic", secret: false };
}

// A code review on tts.voice_id (2026-09-04, "per user selection of
// voice") found SettingsRenderer's own header comment naming this exact
// gap - "Person- and device-scope rendering work the same way through
// SettingsRenderer; only the scope prop changes once there's a UI
// surface to open them from" - and nothing had ever opened one. This is
// that surface's first real test: proves SettingsPage actually asks for
// the signed-in person's OWN scope (`person:<their id>`, never anyone
// else's) and renders what comes back.
describe("SettingsPage renders the signed-in person's own voice settings", () => {
  test("fetches person:<id> scope and shows the Voice section with Speaking voice", async () => {
    const person = makePerson();
    const requestedScopes: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings/registry")) {
        return Promise.resolve(new Response(JSON.stringify(REGISTRY), { status: 200 }));
      }
      if (url.includes("/api/settings?scope=")) {
        const scope = decodeURIComponent(url.split("scope=")[1] ?? "");
        requestedScopes.push(scope);
        if (scope === "household") {
          return Promise.resolve(
            new Response(JSON.stringify([resolved("household.locale", "en-US", "Language and region")]), {
              status: 200,
            }),
          );
        }
        if (scope === `person:${person.id}`) {
          return Promise.resolve(
            new Response(JSON.stringify([resolved("tts.voice_id", "alba", "Speaking voice")]), { status: 200 }),
          );
        }
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByText, findByRole } = renderSettingsPage({ person, onPersonChange: () => {} });

      await findByText("Speaking voice");
      await waitFor(() => expect(requestedScopes).toContain(`person:${person.id}`));
      // Never a different person's scope, and never a bare "person" with
      // no id - the exact mistake that would silently 400 against
      // lib/settings.ts's parseScope(). A "child" actor (makePerson's own
      // default) never sees the household tab at all (step 7: household
      // settings are writable only by owner/admin), so "household" never
      // appears here either - both are the correct, honest scope list.
      expect(requestedScopes.every((s) => s === "household" || s === `person:${person.id}`)).toBe(true);
      // `getByRole`, not `findByText`: "Voice" also names the tree
      // sidebar's own nav button (step 7), so a bare text match is
      // ambiguous between the two.
      await findByRole("heading", { name: "Voice" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // A code review (2026-09-04) found SettingsPage's two SettingsRenderer
  // instances (household, person) each independently fetched the
  // registry - the same response either way, since it doesn't vary by
  // scope - firing two identical GET /api/settings/registry requests on
  // every Settings page visit. Step 7's tabs mean the two instances now
  // mount one at a time (never simultaneously) rather than side by side -
  // an owner/admin actor here, switching from Household to Me, is what
  // proves the shared `staleTime: Infinity` cache survives that
  // unmount/remount instead of just two renderers that happened to share
  // a mount.
  test("fetches the settings registry only once across a Household -> Me tab switch", async () => {
    const person = makePerson("owner");
    let registryFetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings/registry")) {
        registryFetchCount++;
        return Promise.resolve(new Response(JSON.stringify(REGISTRY), { status: 200 }));
      }
      if (url.includes("/api/settings?scope=household")) {
        return Promise.resolve(
          new Response(JSON.stringify([resolved("household.locale", "en-US", "Language and region")]), {
            status: 200,
          }),
        );
      }
      if (url.includes(`/api/settings?scope=${encodeURIComponent(`person:${person.id}`)}`)) {
        return Promise.resolve(
          new Response(JSON.stringify([resolved("tts.voice_id", "alba", "Speaking voice")]), { status: 200 }),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByText, findByRole } = renderSettingsPage({ person, onPersonChange: () => {} });
      await findByText("Language and region");
      fireEvent.click(await findByRole("button", { name: "Me" }));
      await findByText("Speaking voice");
      expect(registryFetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // A code review (2026-09-05) found the tree sidebar's scrollspy
  // IntersectionObserver ran once at mount - before SettingsRenderer's
  // own network-backed queries had resolved, so none of its section
  // elements existed yet - and never got a second chance once they
  // actually appeared (neither of its dependencies changes when async
  // data arrives). This stubs IntersectionObserver to record what it's
  // asked to observe, proving the section is (re-)observed once it
  // really exists in the DOM, not just checked once against an empty page.
  test("the tree sidebar's scrollspy observes a section once it actually mounts, not just at initial render", async () => {
    const person = makePerson("owner");
    const observedIds: string[] = [];
    const originalIO = globalThis.IntersectionObserver;
    class FakeIntersectionObserver {
      observe(el: Element) {
        observedIds.push(el.id);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings/registry")) {
        return Promise.resolve(new Response(JSON.stringify(REGISTRY), { status: 200 }));
      }
      if (url.includes("/api/settings?scope=household")) {
        return Promise.resolve(
          new Response(JSON.stringify([resolved("household.locale", "en-US", "Language and region")]), {
            status: 200,
          }),
        );
      }
      if (url.includes(`/api/settings?scope=${encodeURIComponent(`person:${person.id}`)}`)) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByText } = renderSettingsPage({ person, onPersonChange: () => {} });
      await findByText("Language and region");
      await waitFor(() => expect(observedIds).toContain("settings-household.system"));
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.IntersectionObserver = originalIO;
    }
  });
});

function LocationProbe() {
  return <span data-testid="location-probe">{useLocation().pathname}</span>;
}

// Session B step 7: "real management surfaces rather than settings
// (models, backups, voices, commands) become their own [pages] linked
// from the tree." A tree entry with `to` set has to navigate away, not
// scroll a section into view on this same page - the two other entry
// kinds (`section-hf-token`'s inline anchor, a plain registry-group
// anchor) both call `scrollIntoView` instead, so a regression here would
// silently turn "AI models" back into a dead scroll target with no
// section left on the page to scroll to.
describe("SettingsPage tree - navigable entries", () => {
  test("clicking a tree entry with `to` navigates instead of scrolling", async () => {
    const person = makePerson("owner");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings/registry")) {
        return Promise.resolve(new Response(JSON.stringify(REGISTRY), { status: 200 }));
      }
      if (url.includes("/api/settings?scope=")) {
        // groupSettings.ts skips any registry key with no matching
        // resolved entry (rather than fabricating one from the
        // default) - an empty array here would render "No settings
        // yet." instead of the real household group.
        return Promise.resolve(
          new Response(JSON.stringify([resolved("household.locale", "en-US", "Language and region")]), {
            status: 200,
          }),
        );
      }
      // RoutingStatsSection (still inline on this page - only models/
      // backups/voices/commands moved to their own routes) fetches this
      // regardless of tab; an unstubbed rejection here broke the whole
      // render, not just this one section, when this test was written.
      if (url.includes("/api/plugins/stats")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              total: 0,
              plugin: 0,
              pluginError: 0,
              command: 0,
              commandError: 0,
              model: 0,
              safetyRefuse: 0,
              fallthroughRate: 0,
              byPlugin: [],
              byCommand: [],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByText, findByRole, getByTestId } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsPage person={person} onPersonChange={() => {}} />
          <LocationProbe />
        </MemoryRouter>,
      );
      await findByText("Language and region");
      fireEvent.click(await findByRole("button", { name: "AI models" }));
      expect(getByTestId("location-probe")).toHaveTextContent("/settings/models");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // A code review (2026-09-06) found the test above only covering "AI
  // models" left the other three moved sections untested - a typo in
  // any one `to` path would still pass. Separate renders, not one
  // continuous sequence of clicks: `to` navigation changes the URL with
  // no `tab` query param, which would otherwise wipe the `?tab=me`
  // switch a chained test needs for Voices/Commands (SettingsPage stays
  // mounted across these navigations here - no `<Routes>` in this test
  // to react to the location change - so its own tab state keeps
  // reading the current, now tab-less URL and falls back to Household).
  test.each([
    ["Users", "/settings/users", "household"],
    ["Backups", "/settings/backups", "household"],
    ["Voices", "/settings/voices", "me"],
    ["Commands", "/settings/commands", "me"],
  ] as const)("clicking \"%s\" in the tree navigates to %s", async (label, path, tab) => {
    const person = makePerson("owner");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings/registry")) {
        return Promise.resolve(new Response(JSON.stringify(REGISTRY), { status: 200 }));
      }
      if (url.includes("/api/settings?scope=")) {
        return Promise.resolve(
          new Response(JSON.stringify([resolved("household.locale", "en-US", "Language and region")]), {
            status: 200,
          }),
        );
      }
      if (url.includes("/api/plugins/stats")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              total: 0,
              plugin: 0,
              pluginError: 0,
              command: 0,
              commandError: 0,
              model: 0,
              safetyRefuse: 0,
              fallthroughRate: 0,
              byPlugin: [],
              byCommand: [],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByRole, getByTestId } = renderWithQueryClient(
        <MemoryRouter initialEntries={[tab === "me" ? "/settings?tab=me" : "/settings"]}>
          <SettingsPage person={person} onPersonChange={() => {}} />
          <LocationProbe />
        </MemoryRouter>,
      );
      // `findByRole` itself waits/retries - no separate content gate
      // needed, and "Language and region" (household-only) would never
      // appear on the Me tab anyway.
      fireEvent.click(await findByRole("button", { name: label }));
      expect(getByTestId("location-probe")).toHaveTextContent(path);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function stubSettingsFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/settings/registry")) {
      return Promise.resolve(new Response(JSON.stringify(REGISTRY), { status: 200 }));
    }
    if (url.includes("/api/settings?scope=household")) {
      return Promise.resolve(
        new Response(JSON.stringify([resolved("household.locale", "en-US", "Language and region")]), {
          status: 200,
        }),
      );
    }
    // Any other scope is a `person:<id>` request - the exact id varies per
    // test's own `makePerson()` call, so match on the still-unique prefix
    // rather than needing the caller to thread its person through here too.
    if (url.includes("/api/settings?scope=person")) {
      return Promise.resolve(
        new Response(JSON.stringify([resolved("tts.voice_id", "alba", "Speaking voice")]), { status: 200 }),
      );
    }
    if (url.includes("/api/plugins/stats")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            total: 0,
            plugin: 0,
            pluginError: 0,
            command: 0,
            commandError: 0,
            model: 0,
            safetyRefuse: 0,
            fallthroughRate: 0,
            byPlugin: [],
            byCommand: [],
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// A code review (2026-09-06) found the rail deriving its tree from `?tab=`
// alone once Models/Backups/Voices/Commands became nested routes: clicking
// a Me-tab-only entry (`navigate(entry.to)`) drops the `tab` query param,
// so `tab` fell back to "household" even while Voices/Commands content was
// on screen - the sidebar swapped to HOUSEHOLD_TREE, which doesn't even
// contain the page being shown. The fix makes the pathname itself the
// source of truth for which tree to render whenever it names a known
// nested route, rather than trusting a query param a navigation can drop.
describe("SettingsPage tree - tab stays in sync with the route, not just ?tab=", () => {
  test("clicking a Me-tab entry (Voices) keeps the Me tree, not Household's, even though the URL loses ?tab=me", async () => {
    const person = makePerson("owner");
    const restore = stubSettingsFetch();
    try {
      const { findByRole, findByText, queryByRole } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings?tab=me"]}>
          <SettingsPage person={person} onPersonChange={() => {}} />
        </MemoryRouter>,
      );
      await findByText("Speaking voice");
      fireEvent.click(await findByRole("button", { name: "Voices" }));

      // Still the Me tree (Commands, a PERSON_TREE-only entry, is still
      // there) - not HOUSEHOLD_TREE, which doesn't contain "Voices" at all.
      expect(await findByRole("button", { name: "Commands" })).toBeTruthy();
      expect(queryByRole("button", { name: "AI models" })).toBeNull();
      expect(await findByRole("button", { name: "Me" })).toHaveClass("bg-muted");
    } finally {
      restore();
    }
  });

  test("a non-admin who lands directly on a household-only route still sees the tree that matches it, not the Me tree they're normally forced into", async () => {
    const person = makePerson("child");
    const restore = stubSettingsFetch();
    try {
      const { findByRole, queryByRole } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings/backups"]}>
          <SettingsPage person={person} onPersonChange={() => {}} />
        </MemoryRouter>,
      );
      expect(await findByRole("button", { name: "AI models" })).toBeTruthy();
      expect(queryByRole("button", { name: "Voices" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("a direct/bookmarked URL with a mismatched ?tab= still shows the tree that actually matches the page", async () => {
    const person = makePerson("owner");
    const restore = stubSettingsFetch();
    try {
      // Backups is household-only, but the URL claims tab=me - the route
      // itself must win.
      const { findByRole, queryByRole } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings/backups?tab=me"]}>
          <SettingsPage person={person} onPersonChange={() => {}} />
        </MemoryRouter>,
      );

      expect(await findByRole("button", { name: "AI models" })).toBeTruthy();
      expect(queryByRole("button", { name: "Voices" })).toBeNull();
      expect(await findByRole("button", { name: "Household" })).toHaveClass("bg-muted");
    } finally {
      restore();
    }
  });

  // A code review (2026-09-06) found the scrollspy's `activeId` never got
  // cleared on navigating into a nested route - nothing there for its
  // IntersectionObserver to re-target, so the last scroll-highlighted
  // entry from BEFORE the navigation stayed lit up alongside the newly-
  // active routed entry (two entries highlighted at once).
  test("navigating to a nested route clears a stale scroll-highlighted entry from the tree", async () => {
    const person = makePerson("owner");
    // A holder object, not a plain reassigned `let`: TypeScript's control-
    // flow narrowing can't see across the class constructor closure below
    // into a captured `let` binding, and narrows a later read of it to
    // `never` - a property on an object sidesteps that entirely.
    const callbackHolder: { current: IntersectionObserverCallback | null } = { current: null };
    const originalIO = globalThis.IntersectionObserver;
    class FakeIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        callbackHolder.current = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    const restore = stubSettingsFetch();
    try {
      const { findByRole, findByText } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsPage person={person} onPersonChange={() => {}} />
        </MemoryRouter>,
      );
      await findByText("Language and region");

      // Simulate a real mid-scroll state: "AI model tuning" scrolled into
      // the observer's target zone. A plain detached element with the
      // right id, not a real rendered section - the minimal REGISTRY stub
      // here has nothing in that settings group to actually render one,
      // and the component only ever reads `target.id` off the entry.
      const fakeEl = document.createElement("div");
      fakeEl.id = "settings-household.ai";
      callbackHolder.current?.(
        [{ isIntersecting: true, target: fakeEl, boundingClientRect: { top: 0 } } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(await findByRole("button", { name: "AI model tuning" })).toHaveClass("bg-muted");
      // A scroll-anchor entry (no `to`) is selected, not navigated to -
      // List.tsx's own convention for that ("true"), not "page" (a code
      // review, 2026-09-06, caught a flat "page" applied to both kinds).
      expect(await findByRole("button", { name: "AI model tuning" })).toHaveAttribute("aria-current", "true");

      fireEvent.click(await findByRole("button", { name: "AI models" }));

      // The stale scroll highlight must be gone now that we've left the
      // page it applied to - only the routed entry should be active.
      expect(await findByRole("button", { name: "AI model tuning" })).not.toHaveClass("bg-muted");
      expect(await findByRole("button", { name: "AI model tuning" })).not.toHaveAttribute("aria-current");
      expect(await findByRole("button", { name: "AI models" })).toHaveClass("bg-muted");
      // A routed entry is a real navigation, so it gets "page" - the
      // same signal the shell's own main nav rail already gets from
      // `NavLink` for free.
      expect(await findByRole("button", { name: "AI models" })).toHaveAttribute("aria-current", "page");
    } finally {
      globalThis.IntersectionObserver = originalIO;
      restore();
    }
  });
});

// Jesse, 2026-09-06: clicking "Backups"/"AI models" made the content pane
// "completely fill" and lost the rail, header, and search - the earlier
// standalone routes (ModelsPage.tsx et al.) unmounted SettingsPage
// entirely. Nested child routes (App.tsx) rendered through SettingsPage's
// own <Outlet/> fix this; unlike the tests above (which render SettingsPage
// bare, with no <Routes> around it, since they only assert the URL a click
// navigates to), this one wires up a real nested <Route> so the <Outlet/>
// actually has something to render, proving the shell survives the
// navigation rather than just proving the URL changed.
describe("SettingsPage nested routes keep the shell mounted", () => {
  test("navigating into a nested route keeps the rail, tab switcher, and search box on screen", async () => {
    const person = makePerson("owner");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings/registry")) {
        return Promise.resolve(new Response(JSON.stringify(REGISTRY), { status: 200 }));
      }
      if (url.includes("/api/settings?scope=")) {
        return Promise.resolve(
          new Response(JSON.stringify([resolved("household.locale", "en-US", "Language and region")]), {
            status: 200,
          }),
        );
      }
      if (url.includes("/api/plugins/stats")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              total: 0,
              plugin: 0,
              pluginError: 0,
              command: 0,
              commandError: 0,
              model: 0,
              safetyRefuse: 0,
              fallthroughRate: 0,
              byPlugin: [],
              byCommand: [],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByRole, findByText, findByLabelText } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings"]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage person={person} onPersonChange={() => {}} />}>
              <Route path="models" element={<div>Fake AI models content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      await findByText("Language and region");
      fireEvent.click(await findByRole("button", { name: "AI models" }));

      await findByText("Fake AI models content");
      // The whole point of the fix: these three are still on screen, not
      // gone because SettingsPage unmounted.
      expect(await findByRole("button", { name: "AI models" })).toBeTruthy();
      expect(await findByRole("button", { name: "Household" })).toBeTruthy();
      // Still on screen, but disabled (a code review, 2026-09-06, found it
      // stayed enabled here even though nothing on this route reads what's
      // typed into it) - found by its stable aria-label, not the
      // placeholder text, which changes to say so once disabled.
      expect(await findByLabelText("Search settings")).toBeDisabled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // A code review (2026-09-06) found `location.pathname === "/settings"`
  // rendered a blank <Outlet/> for the harmless "/settings/" (trailing
  // slash) case - nothing recognized it as either the default route or a
  // known nested one. Deriving `isDefaultRoute` from `routeTab` instead
  // (routeTab is null for anything neither tree recognizes, trailing
  // slash included) folds this back into the default view.
  test("a trailing-slash URL (/settings/) still shows the default content, not a blank pane", async () => {
    const person = makePerson("owner");
    const restore = stubSettingsFetch();
    try {
      const { findByText } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings/"]}>
          <SettingsPage person={person} onPersonChange={() => {}} />
        </MemoryRouter>,
      );
      await findByText("Language and region");
    } finally {
      restore();
    }
  });
});
