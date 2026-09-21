import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NextSignInPage } from "@/next/pages/NextSignInPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-abc123",
    display_name: "Sage",
    nickname: null,
    role: "owner",
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
    ...overrides,
  } as Roster;
}

function stubFetch(byPath: Record<string, unknown | (() => Response)>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) return Promise.resolve(new Response("{}", { status: 200 }));
    const value = match[1];
    return Promise.resolve(typeof value === "function" ? value() : Response.json(value));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function renderSignIn(onSignedIn: () => void = () => {}) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/next/sign-in"]}>
      <Routes>
        <Route path="/setup" element={<div>the setup wizard</div>} />
        <Route path="/next/sign-in" element={<NextSignInPage onSignedIn={onSignedIn} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NextSignInPage", () => {
  test("real profiles render, not the template's own email/password demo", async () => {
    const restore = stubFetch({ "/api/auth/profiles": [makePerson({ display_name: "Sage" }), makePerson({ id: "person-def456", display_name: "Marlow", hasSecret: false })] });
    try {
      renderSignIn();
      await waitFor(() => expect(document.body.textContent).toContain("Sage"));
      expect(document.body.textContent).toContain("Marlow");
      expect(document.body.textContent).not.toContain("Enter Your Email");
    } finally {
      restore();
    }
  });

  test("tapping a profile with no secret signs in directly", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({ "/api/auth/profiles": [makePerson({ hasSecret: false })], "/api/auth/select": { success: true } });
    try {
      renderSignIn(onSignedIn);
      const sage = await waitFor(() => {
        const el = document.body.querySelector("button");
        if (!el) throw new Error("not yet rendered");
        return el;
      });
      await act(async () => {
        fireEvent.click(sage);
      });
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  test("tapping a profile with a secret shows the PIN/password prompt, not an immediate sign-in", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({ "/api/auth/profiles": [makePerson({ hasSecret: true })] });
    try {
      renderSignIn(onSignedIn);
      const button = await waitFor(() => {
        const el = document.body.querySelector("button");
        if (!el) throw new Error("not yet rendered");
        return el;
      });
      await act(async () => {
        fireEvent.click(button);
      });
      await waitFor(() => expect(document.body.querySelector('input[type="password"]')).not.toBeNull());
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("a 4-digit numeric PIN submits itself with no separate tap", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({ "/api/auth/profiles": [makePerson()], "/api/auth/verify-secret": { success: true } });
    try {
      renderSignIn(onSignedIn);
      const button = await waitFor(() => {
        const el = document.body.querySelector("button");
        if (!el) throw new Error("not yet rendered");
        return el;
      });
      await act(async () => {
        fireEvent.click(button);
      });
      const input = await waitFor(() => {
        const el = document.body.querySelector('input[type="password"]');
        if (!el) throw new Error("not yet rendered");
        return el as HTMLInputElement;
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "0000" } });
      });
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  test("a wrong secret shows the error inline and keeps the PIN screen, not a full-screen wipe", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson({ display_name: "Sage" })],
      "/api/auth/verify-secret": () => Response.json({ error: "Invalid PIN or password" }, { status: 401 }),
    });
    try {
      renderSignIn(onSignedIn);
      const sageButton = await waitFor(() => {
        const el = document.body.querySelector("button");
        if (!el) throw new Error("not yet rendered");
        return el;
      });
      await act(async () => {
        fireEvent.click(sageButton);
      });
      const input = await waitFor(() => {
        const el = document.body.querySelector('input[type="password"]');
        if (!el) throw new Error("not yet rendered");
        return el as HTMLInputElement;
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "9999" } });
      });
      await waitFor(() => expect(document.body.textContent).toContain("Invalid PIN or password"));
      expect(document.body.textContent).toContain("Sage");
      expect(document.body.textContent).toContain("Back");
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("an empty household redirects to the setup wizard", async () => {
    const restore = stubFetch({ "/api/auth/profiles": [] });
    try {
      renderSignIn();
      await waitFor(() => expect(document.body.textContent).toContain("the setup wizard"));
    } finally {
      restore();
    }
  });

  test("a failed profiles fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderSignIn();
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
