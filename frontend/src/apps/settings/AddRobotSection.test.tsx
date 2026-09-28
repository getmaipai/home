import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AddRobotSection } from "@/apps/settings/AddRobotSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { DiscoveredRobotInfo } from "@/lib/api";

afterEach(cleanup);

function robot(overrides: Partial<DiscoveredRobotInfo> = {}): DiscoveredRobotInfo {
  return {
    name: "reachy_mini",
    host: "reachy-mini.local",
    port: 8000,
    addresses: ["192.0.2.10"],
    model: "wireless",
    daemonVersion: "1.11.0",
    unitId: null,
    ...overrides,
  };
}

interface StubOptions {
  discovered?: DiscoveredRobotInfo[];
  /** null = 200 success; a string = the error message a 400/401 body carries. */
  approveResult?: null | { status: number; message: string };
  onApprove?: (body: { code: string; totpToken?: string }) => void;
}

function stubFetch(opts: StubOptions): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/devices/discover-robots")) {
      return Promise.resolve(new Response(JSON.stringify(opts.discovered ?? []), { status: 200 }));
    }
    if (url.endsWith("/api/auth/quick-connect/approve")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as { code: string; totpToken?: string };
      opts.onApprove?.(body);
      if (opts.approveResult) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: opts.approveResult.message }), { status: opts.approveResult.status }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }
    if (url.endsWith("/api/devices")) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

function renderSection() {
  return renderWithQueryClient(<AddRobotSection />);
}

describe("AddRobotSection", () => {
  test("no robot found says so, not a blank list", async () => {
    const restore = stubFetch({ discovered: [] });
    try {
      const { findByText } = renderSection();
      await findByText("No robot found on your network yet.");
    } finally {
      restore();
    }
  });

  test("a discovered robot shows its name and model", async () => {
    const restore = stubFetch({ discovered: [robot({ name: "reachy_mini", model: "wireless" })] });
    try {
      const { findByText } = renderSection();
      await findByText("reachy_mini");
      await findByText(/wireless/);
    } finally {
      restore();
    }
  });

  test("a valid code pairs without needing a TOTP field", async () => {
    const calls: Array<{ code: string; totpToken?: string }> = [];
    const restore = stubFetch({ discovered: [], onApprove: (body) => calls.push(body) });
    try {
      const { findByPlaceholderText, findByRole, findByText, queryByPlaceholderText } = renderSection();
      fireEvent.change(await findByPlaceholderText("Six-digit code"), { target: { value: "ABC123" } });
      fireEvent.click(await findByRole("button", { name: "Pair" }));
      await findByText(/Approved/);
      expect(calls).toEqual([{ code: "ABC123", totpToken: undefined }]);
      expect(queryByPlaceholderText("Your current 2FA code")).toBeNull();
    } finally {
      restore();
    }
  });

  test("a TOTP-required response reveals the field, and a retry with it succeeds", async () => {
    // stubFetch's single-shot approveResult can't fail once then succeed on
    // a second call to the same route, so this test wires its own mock.
    const calls: Array<{ code: string; totpToken?: string }> = [];
    let first = true;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/devices/discover-robots")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.endsWith("/api/devices")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.endsWith("/api/auth/quick-connect/approve")) {
        const body = JSON.parse((init?.body as string) ?? "{}") as { code: string; totpToken?: string };
        calls.push(body);
        if (first) {
          first = false;
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: "A current TOTP code is required to approve a new device" }),
              { status: 401 },
            ),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;

    try {
      const { findByPlaceholderText, findByRole, findByText } = renderSection();
      fireEvent.change(await findByPlaceholderText("Six-digit code"), { target: { value: "ABC123" } });
      fireEvent.click(await findByRole("button", { name: "Pair" }));

      const totpInput = await findByPlaceholderText("Your current 2FA code");
      fireEvent.change(totpInput, { target: { value: "654321" } });
      fireEvent.click(await findByRole("button", { name: "Pair" }));

      await findByText(/Approved/);
      await waitFor(() =>
        expect(calls).toEqual([
          { code: "ABC123", totpToken: undefined },
          { code: "ABC123", totpToken: "654321" },
        ]),
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  test("an unknown code shows the real error, not a generic one", async () => {
    const restore = stubFetch({ discovered: [], approveResult: { status: 400, message: "That code is no longer valid" } });
    try {
      const { findByPlaceholderText, findByRole, findByText } = renderSection();
      fireEvent.change(await findByPlaceholderText("Six-digit code"), { target: { value: "ZZZZZZ" } });
      fireEvent.click(await findByRole("button", { name: "Pair" }));
      await findByText("That code is no longer valid");
    } finally {
      restore();
    }
  });
});
