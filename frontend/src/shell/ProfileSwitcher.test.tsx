import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ProfileSwitcher } from "@/shell/ProfileSwitcher";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-sage",
    display_name: "Sage",
    nickname: null,
    role: "owner",
    avatar_seed: "person-sage",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// Same fetch-stub approach as SignIn.test.tsx, for the same reason: a
// static import of the api module means mock.module() doesn't reliably
// rebind here.
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

describe("ProfileSwitcher", () => {
  test("opening it shows every other household member, not the signed-in one", async () => {
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson(), makePerson({ id: "person-marlow", display_name: "Marlow" })],
    });
    try {
      const { getByRole, findByText, getAllByText } = render(
        <ProfileSwitcher person={makePerson()} onSwitched={async () => {}} onSignOut={() => {}} />,
      );
      await act(async () => {
        fireEvent.click(getByRole("button", { name: /switch profile or sign out/i }));
      });
      await findByText("Marlow");
      // "Sage" (the signed-in person) still appears once, in the trigger
      // button itself - just never as a second, switch-to-yourself entry
      // in the picker.
      expect(getAllByText("Sage")).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("picking a profile with no secret switches immediately", async () => {
    const onSwitched = mock(async () => {});
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson(), makePerson({ id: "person-marlow", display_name: "Marlow", hasSecret: false })],
      "/api/auth/select": { success: true },
    });
    try {
      const { getByRole, findByText } = render(
        <ProfileSwitcher person={makePerson()} onSwitched={onSwitched} onSignOut={() => {}} />,
      );
      await act(async () => {
        fireEvent.click(getByRole("button", { name: /switch profile or sign out/i }));
      });
      const marlow = await findByText("Marlow");
      await act(async () => {
        fireEvent.click(marlow);
      });
      await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  test("picking a secured profile asks for its PIN before switching", async () => {
    const onSwitched = mock(async () => {});
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson(), makePerson({ id: "person-marlow", display_name: "Marlow", hasSecret: true })],
      "/api/auth/verify-secret": { success: true },
    });
    try {
      const { getByRole, findByText, getByPlaceholderText } = render(
        <ProfileSwitcher person={makePerson()} onSwitched={onSwitched} onSignOut={() => {}} />,
      );
      await act(async () => {
        fireEvent.click(getByRole("button", { name: /switch profile or sign out/i }));
      });
      const marlow = await findByText("Marlow");
      await act(async () => {
        fireEvent.click(marlow);
      });
      const pin = getByPlaceholderText("PIN or password");
      await act(async () => {
        fireEvent.change(pin, { target: { value: "0000" } });
      });
      await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  test("sign out calls the callback", async () => {
    const onSignOut = mock(() => {});
    const restore = stubFetch({ "/api/auth/profiles": [makePerson()] });
    try {
      const { getByRole, findByText } = render(
        <ProfileSwitcher person={makePerson()} onSwitched={async () => {}} onSignOut={onSignOut} />,
      );
      await act(async () => {
        fireEvent.click(getByRole("button", { name: /switch profile or sign out/i }));
      });
      const signOut = await findByText("Sign out");
      await act(async () => {
        fireEvent.click(signOut);
      });
      expect(onSignOut).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
