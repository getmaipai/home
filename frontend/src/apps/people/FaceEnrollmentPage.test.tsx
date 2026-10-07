import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FaceEnrollmentPage } from "@/apps/people/FaceEnrollmentPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { readShellCache } from "@/shell/shellCache";
import type { Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark", "light");
  document.body.className = "";
  localStorage.clear();
});

function makeOperator(): Roster {
  return {
    id: "person-sage",
    display_name: "Sage",
    nickname: null,
    role: "owner",
    avatar_seed: "person-sage",
    source: "hub",
    local_only: false,
    created_at: "2026-09-29T00:00:00.000Z",
    updated_at: "2026-09-29T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

// FACE-02J (2026-09-29): a person who navigates here (from the profile
// page's own "Enroll" button, or a cold direct link) must see the same
// dark/light theme as the rest of the app - not just for THIS render,
// but left behind correctly for the NEXT page's own reload. Renders the
// "no one in this household has that profile" branch (an id that
// matches no roster entry) on purpose: FaceEnrollmentPage's theme hooks
// run unconditionally above every early return, so this branch exercises
// them without needing to mock getUserMedia or the ONNX runtime at all.
describe("FaceEnrollmentPage theme", () => {
  // Covers all three `ui.appearance` values (a second review on this
  // item: the original single-case test only proved "dark", never the
  // "light" or "system" branches `resolveDark` itself already covers in
  // appearanceResolve.test.ts - this proves the same branches wired all
  // the way through the real page, not just the pure function).
  test.each([
    ["dark", false, "dark", "light", true],
    ["light", true, "light", "dark", false],
    ["system", true, "dark", "light", true],
  ] as const)("ui.appearance=%s (OS prefers dark=%p) resolves to %s", async (setting, osPrefersDark, expectedClass, otherClass, expectedCacheDark) => {
    // Saved and restored in `finally`, never deleted (Routes.test.tsx's
    // own pattern): happy-dom's real `matchMedia` has to still exist for
    // every OTHER test file sharing this test process, and an earlier
    // version of this test that did `delete window.matchMedia` in an
    // `afterEach` broke 32 unrelated tests elsewhere in the suite that run
    // after this file.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = mock(() => ({ matches: osPrefersDark, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          Response.json([
            { scope: "person:person-sage", key: "ui.appearance", value: setting },
            { scope: "person:person-sage", key: "ui.look", value: "neutral" },
          ]),
        );
      }
      if (url.includes("/api/people")) return Promise.resolve(Response.json([]));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/people/person-nobody/enroll-face"]}>
          <Routes>
            <Route path="/people/:id/enroll-face" element={<FaceEnrollmentPage operator={makeOperator()} />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(document.documentElement.classList.contains(expectedClass)).toBe(true);
        expect(document.documentElement.classList.contains(otherClass)).toBe(false);
        expect(document.body.classList.contains("style-neutral")).toBe(true);
      });

      // The regression itself (a review caught this before it shipped):
      // the per-browser cache `main.tsx` pre-paints from on the NEXT
      // page's own reload must hold the resolved value, not a stale or
      // default-false one. `useLook`'s own cache write only
      // preserves whatever is already cached - if the appearance hook
      // above never wrote the real value first, this stays wrong
      // forever after a single visit here.
      await waitFor(() => {
        expect(readShellCache()).toEqual({ look: "neutral", dark: expectedCacheDark });
      });
    } finally {
      window.matchMedia = originalMatchMedia;
      globalThis.fetch = originalFetch;
    }
  });
});
