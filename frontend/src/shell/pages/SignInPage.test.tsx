import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SignInPage } from "@/shell/pages/SignInPage";
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
    pinDigits: 4,
    ...overrides,
  } as Roster;
}

function buttonByText(pattern: RegExp): HTMLButtonElement {
  const el = Array.from(document.body.querySelectorAll("button")).find((b) => pattern.test(b.textContent ?? ""));
  if (!el) throw new Error(`no button matching ${pattern}`);
  return el as HTMLButtonElement;
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
    <MemoryRouter initialEntries={["/sign-in"]}>
      <Routes>
        <Route path="/setup" element={<div>the setup wizard</div>} />
        <Route path="/sign-in" element={<SignInPage onSignedIn={onSignedIn} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SignInPage", () => {
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

  test("tapping a profile with a secret shows the numeric PIN keypad, not an immediate sign-in", async () => {
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
      await waitFor(() => expect(document.body.querySelector('input[data-input-otp]')).not.toBeNull());
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
        const el = document.body.querySelector('input[data-input-otp]');
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
        const el = document.body.querySelector('input[data-input-otp]');
        if (!el) throw new Error("not yet rendered");
        return el as HTMLInputElement;
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: "9999" } });
      });
      await waitFor(() => expect(document.body.textContent).toContain("Invalid PIN or password"));
      expect(document.body.textContent).toContain("Sage");
      expect(document.body.textContent).toContain("Back");
      // A person whose secret is longer than 4 characters is told where to go.
      expect(document.body.textContent).toContain('Tap "Use a password instead"');
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

// NEXT-RETIRE-02C: PIN edge cases ported from the retired
// sign-in test. The live SignInPage keeps the same auto-submit rules.
describe("SignInPage PIN edge cases (ported from the retired SignIn)", () => {
  async function openPinScreen(onSignedIn: () => void = () => {}) {
    renderSignIn(onSignedIn);
    const button = await waitFor(() => {
      const el = document.body.querySelector("button");
      if (!el) throw new Error("not yet rendered");
      return el;
    });
    await act(async () => {
      fireEvent.click(button);
    });
    return await waitFor(() => {
      const el = document.body.querySelector('input[data-input-otp]');
      if (!el) throw new Error("not yet rendered");
      return el as HTMLInputElement;
    });
  }

  test("typing fewer than 4 digits never auto-submits", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({ "/api/auth/profiles": [makePerson()], "/api/auth/verify-secret": { success: true } });
    try {
      const input = await openPinScreen(onSignedIn);
      await act(async () => {
        fireEvent.change(input, { target: { value: "000" } });
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("a longer numeric PIN, entered through the password field, is never cut off by the 4-digit auto-submit", async () => {
    const onSignedIn = mock(() => {});
    const restore = stubFetch({ "/api/auth/profiles": [makePerson()], "/api/auth/verify-secret": () => Response.json({ success: true }) });
    try {
      await openPinScreen(onSignedIn);
      await act(async () => {
        fireEvent.click(buttonByText(/use a password instead/i));
      });
      const input = document.body.querySelector('input[type="password"]') as HTMLInputElement;
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
        return Response.json({ error: "wrong PIN" }, { status: 401 });
      },
    });
    try {
      const input = await openPinScreen(onSignedIn);
      await act(async () => {
        fireEvent.change(input, { target: { value: "1234" } });
      });
      await waitFor(() => expect(verifyCalls).toBe(1));
      await act(async () => {
        fireEvent.change(input, { target: { value: "12345" } });
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(verifyCalls).toBe(1);
      expect(onSignedIn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("a stale tap-error from a different profile doesn't resurface after a PIN flow", async () => {
    const restore = stubFetch({
      "/api/auth/profiles": [makePerson({ id: "person-def456", display_name: "Bramble", hasSecret: false }), makePerson({ display_name: "Jesse" })],
      "/api/auth/select": () => Response.json({ error: "profile disabled" }, { status: 403 }),
    });
    try {
      renderSignIn();
      const bramble = await waitFor(() => {
        const el = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("Bramble"));
        if (!el) throw new Error("not yet rendered");
        return el;
      });
      await act(async () => {
        fireEvent.click(bramble);
      });
      await waitFor(() => expect(document.body.textContent).toContain("profile disabled"));
      const jesse = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("Jesse"))!;
      await act(async () => {
        fireEvent.click(jesse);
      });
      await waitFor(() => expect(document.body.querySelector('input[data-input-otp]')).not.toBeNull());
      expect(document.body.textContent).not.toContain("profile disabled");
    } finally {
      restore();
    }
  });
});

// MOBILE-LIVE-01 (found on a phone, 2026-10-11): after picking a profile the
// credential step was a plain text box, so a phone showed the full keyboard.
describe("SignInPage credential step is a numeric keypad (MOBILE-LIVE-01)", () => {
  async function openCredentialStep(restoreOverrides: Record<string, unknown> = {}) {
    const restore = stubFetch({ "/api/auth/profiles": [makePerson()], "/api/auth/verify-secret": { success: true }, ...restoreOverrides });
    const onSignedIn = mock(() => {});
    renderSignIn(onSignedIn);
    const button = await waitFor(() => {
      const el = document.body.querySelector("button");
      if (!el) throw new Error("not yet rendered");
      return el;
    });
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(document.body.querySelector("input[data-input-otp]")).not.toBeNull());
    return { restore, onSignedIn };
  }

  test("the field is a numeric, four-slot PIN entry, with no text or password box", async () => {
    const { restore } = await openCredentialStep();
    try {
      const otp = document.body.querySelector("input[data-input-otp]") as HTMLInputElement;
      expect(otp.getAttribute("inputmode")).toBe("numeric");
      expect(document.body.querySelectorAll('[data-slot="input-otp-slot"]').length).toBe(4);
      expect(document.body.querySelector('input[type="password"]')).toBeNull();
      expect(document.body.querySelector('input[type="text"]:not([data-input-otp])')).toBeNull();
    } finally {
      restore();
    }
  });

  test("'Use a password instead' reaches a password field and signs in, and 'Use a PIN instead' returns to the keypad", async () => {
    let sent: { secret?: string } = {};
    const { restore, onSignedIn } = await openCredentialStep({
      "/api/auth/verify-secret": () => Response.json({ success: true }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/auth/verify-secret")) sent = JSON.parse(String(init?.body ?? "{}"));
      return originalFetch(input, init);
    }) as unknown as typeof fetch;
    try {
      await act(async () => {
        fireEvent.click(buttonByText(/use a password instead/i));
      });
      const field = document.body.querySelector('input[type="password"]') as HTMLInputElement;
      expect(field).not.toBeNull();
      expect(document.body.querySelector("input[data-input-otp]")).toBeNull();
      await act(async () => {
        fireEvent.change(field, { target: { value: "correct horse battery" } });
      });
      await act(async () => {
        fireEvent.click(buttonByText(/^sign in$/i));
      });
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(sent.secret).toBe("correct horse battery");
      await act(async () => {
        fireEvent.click(buttonByText(/use a pin instead/i));
      });
      expect(document.body.querySelector("input[data-input-otp]")).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });
});

describe("SignInPage sizes the keypad to the account (pinDigits, 2026-10-17)", () => {
  async function openFor(person: Roster, verify: () => Response) {
    const restore = stubFetch({ "/api/auth/profiles": [person], "/api/auth/verify-secret": verify });
    const onSignedIn = mock(() => {});
    renderSignIn(onSignedIn);
    const button = await waitFor(() => {
      const el = document.body.querySelector("button");
      if (!el) throw new Error("not yet rendered");
      return el;
    });
    await act(async () => {
      fireEvent.click(button);
    });
    return { restore, onSignedIn };
  }

  test("a 6-digit passcode shows six slots and makes exactly one attempt, none at 4 digits", async () => {
    let calls = 0;
    const secrets: string[] = [];
    const original = globalThis.fetch;
    const { restore, onSignedIn } = await openFor(makePerson({ pinDigits: 6 }), () => {
      calls += 1;
      return Response.json({ success: true });
    });
    const stubbed = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/auth/verify-secret")) secrets.push(JSON.parse(String(init?.body ?? "{}")).secret);
      return stubbed(input, init);
    }) as unknown as typeof fetch;
    try {
      const input = await waitFor(() => {
        const el = document.body.querySelector("input[data-input-otp]");
        if (!el) throw new Error("not yet rendered");
        return el as HTMLInputElement;
      });
      expect(document.body.querySelectorAll('[data-slot="input-otp-slot"]').length).toBe(6);
      for (const partial of ["1", "12", "123", "1234", "12345"]) {
        await act(async () => {
          fireEvent.change(input, { target: { value: partial } });
        });
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toBe(0);
      await act(async () => {
        fireEvent.change(input, { target: { value: "123456" } });
      });
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(calls).toBe(1);
      expect(secrets).toEqual(["123456"]);
    } finally {
      globalThis.fetch = original;
      restore();
    }
  });

  test("an unknown length (pinDigits null) shows the password field and never auto-submits", async () => {
    let calls = 0;
    const { restore, onSignedIn } = await openFor(makePerson({ pinDigits: null }), () => {
      calls += 1;
      return Response.json({ success: true });
    });
    try {
      const field = await waitFor(() => {
        const el = document.body.querySelector('input[type="password"]');
        if (!el) throw new Error("not yet rendered");
        return el as HTMLInputElement;
      });
      expect(document.body.querySelector("input[data-input-otp]")).toBeNull();
      for (const v of ["1234", "123456"]) {
        await act(async () => {
          fireEvent.change(field, { target: { value: v } });
        });
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toBe(0);
      await act(async () => {
        fireEvent.click(buttonByText(/^sign in$/i));
      });
      await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
      expect(calls).toBe(1);
    } finally {
      restore();
    }
  });
});
