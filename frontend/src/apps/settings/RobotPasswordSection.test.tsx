import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { RobotPasswordSection } from "@/apps/settings/RobotPasswordSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { DeviceInfo } from "@/lib/api";
import { waitForGone } from "../../../tests/waitForGone";

afterEach(cleanup);

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: "device-robot-1",
    kind: "robot",
    name: "Reachy Mini",
    area: null,
    lastSeenAt: null,
    createdAt: "2026-09-27T00:00:00.000Z",
    capabilities: [],
    ...overrides,
  };
}

interface StubOptions {
  devices?: DeviceInfo[];
  rotated?: boolean;
  rotateResult?: null | { status: number; message: string };
  onRotate?: (body: { host: string; currentPassword: string }) => void;
}

function stubFetch(opts: StubOptions): () => void {
  const original = globalThis.fetch;
  let rotated = opts.rotated ?? false;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/devices/robots")) {
      return Promise.resolve(new Response(JSON.stringify(opts.devices ?? []), { status: 200 }));
    }
    if (url.endsWith("/robot-password-status")) {
      return Promise.resolve(new Response(JSON.stringify({ rotated }), { status: 200 }));
    }
    if (url.endsWith("/rotate-robot-password")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as { host: string; currentPassword: string };
      opts.onRotate?.(body);
      if (opts.rotateResult) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: opts.rotateResult.message }), { status: opts.rotateResult.status }),
        );
      }
      rotated = true;
      return Promise.resolve(new Response(JSON.stringify({ success: true, rotatedAt: "now" }), { status: 200 }));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

function renderSection() {
  return renderWithQueryClient(<RobotPasswordSection />);
}

describe("RobotPasswordSection", () => {
  test("renders nothing when there are no robots", async () => {
    const restore = stubFetch({ devices: [] });
    try {
      const { container } = renderSection();
      await waitFor(() => expect(container.textContent).toBe(""));
    } finally {
      restore();
    }
  });

  test("a robot still on the vendor default shows that badge", async () => {
    const restore = stubFetch({ devices: [device()], rotated: false });
    try {
      const { findByText } = renderSection();
      await findByText("Reachy Mini");
      await findByText("Vendor default");
    } finally {
      restore();
    }
  });

  test("an already-rotated robot shows Rotated and offers Rotate again", async () => {
    const restore = stubFetch({ devices: [device()], rotated: true });
    try {
      const { findByText, findByRole } = renderSection();
      await findByText("Rotated");
      await findByRole("button", { name: "Rotate again" });
    } finally {
      restore();
    }
  });

  test("rotating sends the host and password, then hides the form", async () => {
    const calls: Array<{ host: string; currentPassword: string }> = [];
    const restore = stubFetch({ devices: [device()], rotated: false, onRotate: (body) => calls.push(body) });
    try {
      const { findByRole, findByPlaceholderText, queryByPlaceholderText } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Rotate password" }));
      fireEvent.change(await findByPlaceholderText("Robot's LAN address"), { target: { value: "192.0.2.10" } });
      fireEvent.change(await findByPlaceholderText("Current password (leave blank to try the last one used)"), { target: { value: "vendor-default" } });
      fireEvent.click(await findByRole("button", { name: "Rotate" }));

      await waitFor(() => expect(calls).toEqual([{ host: "192.0.2.10", currentPassword: "vendor-default" }]));
      await waitForGone(() => queryByPlaceholderText("Robot's LAN address"));
    } finally {
      restore();
    }
  });

  test("a failed rotation shows the real error and keeps the form open", async () => {
    const restore = stubFetch({
      devices: [device()],
      rotated: false,
      rotateResult: { status: 400, message: "Could not connect or change the password" },
    });
    try {
      const { findByRole, findByPlaceholderText, findByText } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Rotate password" }));
      fireEvent.change(await findByPlaceholderText("Robot's LAN address"), { target: { value: "192.0.2.10" } });
      fireEvent.change(await findByPlaceholderText("Current password (leave blank to try the last one used)"), { target: { value: "wrong" } });
      fireEvent.click(await findByRole("button", { name: "Rotate" }));

      await findByText("Could not connect or change the password");
      await findByPlaceholderText("Robot's LAN address");
    } finally {
      restore();
    }
  });
});
