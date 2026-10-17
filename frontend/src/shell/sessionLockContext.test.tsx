import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SessionLockGate } from "@/shell/sessionLockContext";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { SignedInPerson } from "@/lib/api";
import { waitForGone } from "../../tests/waitForGone";

afterEach(() => {
  cleanup();
});

function makePerson(overrides: Partial<SignedInPerson> = {}): SignedInPerson {
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
    sessionLockRequired: false,
    sessionLockTimeoutMinutes: 5,
    ...overrides,
  } as SignedInPerson;
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

// 40ms real time: sessionLockTimeoutMinutes is a plain number at the type
// level (the backend's own integer/1-120 range is a server-side
// validation rule, not a client-side one), so a fractional-minute value
// here exercises the SAME *60*1000 conversion the component really runs,
// just fast enough for a test - not a mocked/overridden timer.
const FAST_TIMEOUT_MINUTES = 40 / 60000;

describe("SessionLockGate", () => {
  test("renders children with no overlay when the account doesn't require a lock", async () => {
    renderWithQueryClient(
      <SessionLockGate person={makePerson({ sessionLockRequired: false })}>
        <div>the app</div>
      </SessionLockGate>,
    );
    expect(document.body.textContent).toContain("the app");
    await new Promise((r) => setTimeout(r, 60));
    expect(document.body.querySelector('input[type="password"]')).toBeNull();
  });

  test("renders children with no overlay when signed out (person is null)", async () => {
    renderWithQueryClient(
      <SessionLockGate person={null}>
        <div>the app</div>
      </SessionLockGate>,
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(document.body.querySelector('input[type="password"]')).toBeNull();
  });

  test("locks behind a PIN prompt after the configured inactivity window - content stays mounted underneath, not wiped", async () => {
    renderWithQueryClient(
      <SessionLockGate person={makePerson({ sessionLockRequired: true, sessionLockTimeoutMinutes: FAST_TIMEOUT_MINUTES })}>
        <div>the app</div>
      </SessionLockGate>,
    );
    await waitFor(() => expect(document.body.querySelector('input[type="password"]')).not.toBeNull());
    // The forced-wipe idle timeout an earlier draft proposed (Jesse's own
    // correction, 2026-09-25) is explicitly not this: the app's own
    // content is still in the DOM, just covered.
    expect(document.body.textContent).toContain("the app");
  });

  test("the right PIN unlocks and dismisses the overlay", async () => {
    const restore = stubFetch({ "/api/auth/verify-secret": { success: true } });
    try {
      renderWithQueryClient(
        <SessionLockGate person={makePerson({ sessionLockRequired: true, sessionLockTimeoutMinutes: FAST_TIMEOUT_MINUTES })}>
          <div>the app</div>
        </SessionLockGate>,
      );
      const input = await waitFor(() => {
        const el = document.body.querySelector('input[type="password"]');
        if (!el) throw new Error("not locked yet");
        return el as HTMLInputElement;
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "correcthorse" } });
      });
      const button = document.body.querySelector("button[type=submit]") as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(button);
      });
      await waitForGone(() => document.body.querySelector('input[type="password"]'));
    } finally {
      restore();
    }
  });

  test("a 6-digit PIN account is never tried at 4 digits; one attempt at 6 (pinDigits, 2026-10-17)", async () => {
    let calls = 0;
    const restore = stubFetch({
      "/api/auth/verify-secret": () => {
        calls += 1;
        return Response.json({ success: true });
      },
    });
    try {
      renderWithQueryClient(
        <SessionLockGate person={makePerson({ pinDigits: 6, sessionLockRequired: true, sessionLockTimeoutMinutes: FAST_TIMEOUT_MINUTES })}>
          <div>the app</div>
        </SessionLockGate>,
      );
      const input = await waitFor(() => {
        const el = document.body.querySelector("input[data-input-otp]");
        if (!el) throw new Error("not locked yet");
        return el as HTMLInputElement;
      });
      expect(document.body.querySelectorAll('[data-slot="passcode-input-slot"]').length).toBe(6);
      expect(document.body.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Enter your 6-digit passcode");
      for (const v of ["1", "12", "123", "1234", "12345"]) {
        await act(async () => {
          fireEvent.change(input, { target: { value: v } });
        });
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toBe(0);
      await act(async () => {
        fireEvent.change(input, { target: { value: "123456" } });
      });
      await waitForGone(() => document.body.querySelector("input[data-input-otp]"));
      expect(calls).toBe(1);
    } finally {
      restore();
    }
  });

  test("a wrong PIN shows an inline error and stays locked", async () => {
    const restore = stubFetch({
      "/api/auth/verify-secret": () => Response.json({ error: "Invalid PIN or password" }, { status: 401 }),
    });
    try {
      renderWithQueryClient(
        <SessionLockGate person={makePerson({ sessionLockRequired: true, sessionLockTimeoutMinutes: FAST_TIMEOUT_MINUTES })}>
          <div>the app</div>
        </SessionLockGate>,
      );
      const input = await waitFor(() => {
        const el = document.body.querySelector('input[type="password"]');
        if (!el) throw new Error("not locked yet");
        return el as HTMLInputElement;
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "wrong" } });
      });
      const button = document.body.querySelector("button[type=submit]") as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(button);
      });
      await waitFor(() => expect(document.body.textContent).toContain("That PIN or password is not right"));
      expect(document.body.querySelector('input[type="password"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  test("a lockout on the lock screen disables the boxes and shows the time left", async () => {
    const restore = stubFetch({
      "/api/auth/verify-secret": () => Response.json({ error: "Too many attempts", retryAfter: 120 }, { status: 429 }),
    });
    try {
      renderWithQueryClient(
        <SessionLockGate person={makePerson({ pinDigits: 4, sessionLockRequired: true, sessionLockTimeoutMinutes: FAST_TIMEOUT_MINUTES })}>
          <div>the app</div>
        </SessionLockGate>,
      );
      const input = await waitFor(() => {
        const el = document.body.querySelector("input[data-input-otp]");
        if (!el) throw new Error("not locked yet");
        return el as HTMLInputElement;
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "0000" } });
      });
      await waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Try again in 2:00"));
      expect((document.body.querySelector("input[data-input-otp]") as HTMLInputElement).disabled).toBe(true);
    } finally {
      restore();
    }
  });

  test("a PIN account can fall back to a password on the lock screen and a server error keeps the typed code", async () => {
    let status = 500;
    const restore = stubFetch({
      "/api/auth/verify-secret": () => Response.json({ error: "boom" }, { status }),
    });
    try {
      renderWithQueryClient(
        <SessionLockGate person={makePerson({ pinDigits: 4, sessionLockRequired: true, sessionLockTimeoutMinutes: FAST_TIMEOUT_MINUTES })}>
          <div>the app</div>
        </SessionLockGate>,
      );
      const input = await waitFor(() => {
        const el = document.body.querySelector("input[data-input-otp]");
        if (!el) throw new Error("not locked yet");
        return el as HTMLInputElement;
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "1234" } });
      });
      await waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Check your connection"));
      // not judged: the code stays typed and the boxes are not red
      expect((document.body.querySelector("input[data-input-otp]") as HTMLInputElement).value).toBe("1234");
      document.body.querySelectorAll('[data-slot="passcode-input-slot"]').forEach((el) => expect(el.getAttribute("data-invalid")).toBeNull());
      status = 401;
      const toggle = Array.from(document.body.querySelectorAll("button")).find((b) => /use a password instead/i.test(b.textContent ?? ""))!;
      await act(async () => {
        fireEvent.click(toggle);
      });
      expect(document.body.querySelector("input[data-input-otp]")).toBeNull();
      expect(document.body.querySelector('input[type="password"]')).not.toBeNull();
    } finally {
      restore();
    }
  });
});
