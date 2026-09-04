import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { render, cleanup, waitFor } from "@testing-library/react";
import { SettingsPage } from "@/apps/settings/SettingsPage";
import { __resetSettingsRegistryCacheForTests } from "@/kit/settings/SettingsRenderer";
import type { Roster, SettingsKey, ResolvedSetting } from "@/lib/api";

// SettingsRenderer's registry cache is module state shared across every
// test in this process, not reset automatically between tests.
beforeEach(__resetSettingsRegistryCacheForTests);
afterEach(cleanup);

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
      const { findByText } = render(<SettingsPage person={person} onPersonChange={() => {}} />);

      await findByText("Speaking voice");
      await waitFor(() => expect(requestedScopes).toContain(`person:${person.id}`));
      // Never a different person's scope, and never a bare "person" with
      // no id - the exact mistake that would silently 400 against
      // lib/settings.ts's parseScope().
      expect(requestedScopes.every((s) => s === "household" || s === `person:${person.id}`)).toBe(true);
      await findByText("Voice");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // A code review (2026-09-04) found SettingsPage's two SettingsRenderer
  // instances (household, person) each independently fetched the
  // registry - the same response either way, since it doesn't vary by
  // scope - firing two identical GET /api/settings/registry requests on
  // every Settings page visit.
  test("fetches the settings registry only once for both renderer instances combined", async () => {
    const person = makePerson();
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
      const { findByText } = render(<SettingsPage person={person} onPersonChange={() => {}} />);
      await findByText("Speaking voice");
      await findByText("Language and region");
      expect(registryFetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
