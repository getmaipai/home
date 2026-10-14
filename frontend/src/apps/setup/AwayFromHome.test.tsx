import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AwayFromHome } from "@/apps/setup/AwayFromHome";
import { makePerson } from "@/shell/pages/settings/settingsTestKit";
import type { SignedInPerson, TailscaleStatus } from "@/lib/api";

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;
const owner = { ...makePerson("owner"), sessionLockRequired: false, sessionLockTimeoutMinutes: 0 } as SignedInPerson;
const notInstalled: TailscaleStatus = { state: "not_installed", dnsName: null, ips: [], installed: false, signedIn: false, httpsEnabled: false, machineName: null, enabled: false, url: null };
const tailnetReady: TailscaleStatus = { state: "running", dnsName: "home.example.ts.net", ips: [], installed: true, signedIn: true, httpsEnabled: true, machineName: "home", enabled: false, url: null };
const enabled: TailscaleStatus = { ...tailnetReady, enabled: true, url: "https://home.example.ts.net" };

function installApi(status: TailscaleStatus) {
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/tailscale/status") return Response.json(status);
    if (url.pathname === "/api/tailscale/enable") return Response.json({ url: "https://home.example.ts.net", qrPayload: "https://home.example.ts.net" });
    throw new Error(`Unstubbed request ${url.pathname}`);
  }) as unknown as typeof fetch;
  return calls;
}

function renderAway(operator: SignedInPerson | null, from = "/settings/home/network") {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/setup/away", state: { from } }]}>
      <output data-testid="path"><Path /></output>
      <Routes>
        <Route path="/setup/away" element={<AwayFromHome operator={operator} />} />
        <Route path="/settings/home/network" element={<p>Network settings</p>} />
        <Route path="/settings/home/general" element={<p>Home settings</p>} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function Path() {
  return useLocation().pathname;
}

describe("AwayFromHome", () => {
  test("away wizard resumes at the first unfinished step from live status", async () => {
    installApi(tailnetReady);
    const secure = renderAway(owner);
    await secure.findByRole("heading", { name: "Turn on secure addresses" });
    secure.unmount();

    installApi(enabled);
    const phone = renderAway(owner);
    await phone.findByRole("heading", { name: "Scan the code on your phone" });
    expect(phone.getByRole("img", { name: "QR code for your Home address away from home" })).toBeTruthy();
  });

  test("Back keeps the live setup state and Close returns to the page it came from", async () => {
    installApi(enabled);
    const view = renderAway(owner, "/settings/home/general");
    await view.findByRole("heading", { name: "Scan the code on your phone" });
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(view.getByRole("heading", { name: "Turn on secure addresses" })).toBeTruthy());
    expect(view.getByText("Ready")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(view.getByRole("heading", { name: "Scan the code on your phone" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(view.getByText("Home settings")).toBeTruthy());
    expect(view.getByTestId("path").textContent).toBe("/settings/home/general");
  });

  test("signed-out and non-admin visitors see who can set it up and make no Tailscale request", () => {
    const calls = installApi(notInstalled);
    const signedOut = renderAway(null);
    expect(signedOut.getByText("Sign in to MaiPai Home to continue.")).toBeTruthy();
    expect(signedOut.getByText("Only the owner or an admin can set up away access.")).toBeTruthy();
    expect(signedOut.getByRole("link", { name: "Go to Home" })).toBeTruthy();
    signedOut.unmount();

    const adult = { ...makePerson("adult"), sessionLockRequired: false, sessionLockTimeoutMinutes: 0 } as SignedInPerson;
    const nonAdmin = renderAway(adult);
    expect(nonAdmin.getByText("Only the owner or an admin can set up away access.")).toBeTruthy();
    expect(nonAdmin.getByText("Ask one of them to finish this setup for your Home.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  test("enables the secure address before showing its QR code", async () => {
    const calls = installApi(tailnetReady);
    const view = renderAway(owner);
    await view.findByRole("heading", { name: "Turn on secure addresses" });
    fireEvent.click(view.getByRole("button", { name: "Turn on away access" }));
    await view.findByRole("img", { name: "QR code for your Home address away from home" });
    expect(calls).toContain("POST /api/tailscale/enable");
  });
});
