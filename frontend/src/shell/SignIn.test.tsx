import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { SignIn } from "@/shell/SignIn";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-abc123",
    display_name: "Jesse",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// Same fetch-stub approach as ChangeSecretSection.test.tsx: this file's
// static import of SignIn means Bun's module cache won't reliably re-bind
// a mock.module()-registered "@/lib/api" mock.
function stubFetch(byPath: Record<string, unknown | (() => Response)>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    const value = match[1];
    return Promise.resolve(typeof value === "function" ? value() : jsonResponse(value));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// selectJesse() awaits findByText OUTSIDE of act() (only the click itself
// is wrapped) - matching ModelsSection.test.tsx's proven pattern. A first
// version of this file nested the await *inside* act(), which left every
// test hung forever waiting on "Jesse" to appear even though the stubbed
// fetch resolved correctly on its own (confirmed with a throwaway debug
// test) - act() wrapping an async findByText call, instead of the plain
// event it's meant for, is the actual bug, not the stub.
async function selectJesse(rendered: ReturnType<typeof render>) {
  const jesse = await rendered.findByText("Jesse");
  await act(async () => {
    fireEvent.click(jesse);
  });
}

describe("SignIn auto-submit", () => {
  test("a 4-digit numeric PIN submits itself with no separate tap", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson()],
      "/api/auth/verify-secret": { success: true },
    });
    try {
      const rendered = render(<SignIn onSignedIn={onSignedIn} />);
      await selectJesse(rendered);
      const input = rendered.getByPlaceholderText("PIN or password");
      await act(async () => {
        fireEvent.change(input, { target: { value: "0000" } });
      });
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  test("typing fewer than 4 digits never auto-submits", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson()],
      "/api/auth/verify-secret": { success: true },
    });
    try {
      const rendered = render(<SignIn onSignedIn={onSignedIn} />);
      await selectJesse(rendered);
      const input = rendered.getByPlaceholderText("PIN or password");
      await act(async () => {
        fireEvent.change(input, { target: { value: "000" } });
      });
      // Give any (wrongly-firing) effect a tick to run before asserting
      // it didn't.
      await new Promise((r) => setTimeout(r, 50));
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("a longer numeric PIN is never cut off by the 4-digit auto-submit", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson()],
      // Any real call here proves the auto-submit fired when it must
      // not have - a genuine 6-digit entry never passes through an
      // exactly-4-character state in one fireEvent.change.
      "/api/auth/verify-secret": () => jsonResponse({ success: true }),
    });
    try {
      const rendered = render(<SignIn onSignedIn={onSignedIn} />);
      await selectJesse(rendered);
      const input = rendered.getByPlaceholderText("PIN or password");
      await act(async () => {
        fireEvent.change(input, { target: { value: "123456" } });
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("a wrong 4-digit auto-submit doesn't keep re-firing on further keystrokes", async () => {
    const onSignedIn = mock(() => {});
    let verifyCalls = 0;
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson()],
      "/api/auth/verify-secret": () => {
        verifyCalls += 1;
        return jsonResponse({ error: "wrong PIN" }, 401);
      },
    });
    try {
      const rendered = render(<SignIn onSignedIn={onSignedIn} />);
      await selectJesse(rendered);
      const input = rendered.getByPlaceholderText("PIN or password");
      await act(async () => {
        fireEvent.change(input, { target: { value: "1234" } });
      });
      await waitFor(() => expect(verifyCalls).toBe(1));
      await act(async () => {
        fireEvent.change(input, { target: { value: "12345" } });
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(verifyCalls).toBe(1); // still 1, not re-fired for every extra digit
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
