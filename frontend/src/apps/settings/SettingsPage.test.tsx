import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
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
  return renderWithQueryClient(
    <MemoryRouter>
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
