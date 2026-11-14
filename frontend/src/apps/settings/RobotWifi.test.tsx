import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { RobotWifi } from "@/apps/settings/RobotWifi";

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

test("lists saved networks and confirms before forgetting", async () => {
  globalThis.fetch = (async () => Response.json({ sent: true }, { status: 202 })) as unknown as typeof fetch;
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: ["Home", "Guest"], link_encrypted: true }} />);
  expect(view.getByText("Home")).toBeTruthy();
  expect(view.getByText("Guest")).toBeTruthy();
  fireEvent.click(view.getAllByRole("button", { name: "Forget" })[0]!);
  expect(view.getByText("Forget Home on this robot?")).toBeTruthy();
});

test("does not show password form when the link is not encrypted", () => {
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: [], link_encrypted: false }} />);
  expect(view.queryByLabelText("Wi-Fi password")).toBeNull();
  expect(view.getByText(/For safety, a Wi-Fi password is not sent/)).toBeTruthy();
});

test("clears the password field after submit", async () => {
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return Response.json({ sent: true }, { status: 202 });
  }) as typeof fetch;
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: [], link_encrypted: true }} />);
  fireEvent.change(view.getByLabelText("Network name"), { target: { value: "Home" } });
  fireEvent.change(view.getByLabelText("Wi-Fi password"), { target: { value: "PrivateFixture987" } });
  fireEvent.click(view.getByRole("button", { name: "Add network" }));
  await waitFor(() => expect((view.getByLabelText("Wi-Fi password") as HTMLInputElement).value).toBe(""));
  expect(bodies[0]).toContain("PrivateFixture987");
});

test("a full list of 10 networks says so and shows no add form", () => {
  const names = Array.from({ length: 10 }, (_, index) => `Network ${index}`);
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: names, link_encrypted: true }} />);
  expect(view.getByText("This robot already holds 10 Wi-Fi networks. Forget one to add another.")).toBeTruthy();
  expect(view.queryByLabelText("Wi-Fi password")).toBeNull();
  expect(view.getAllByRole("button", { name: "Forget" }).length).toBe(10);
});

test("Use this network now sends the use action for that network only", async () => {
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return Response.json({ sent: true }, { status: 202 });
  }) as typeof fetch;
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: ["Home", "Hotspot"], link_encrypted: true }} />);
  fireEvent.click(view.getAllByRole("button", { name: "Use this network now" })[1]!);
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(JSON.parse(bodies[0]!)).toEqual({ action: "use", ssid: "Hotspot" });
  await waitFor(() => expect(view.getByText(/goes back by itself/)).toBeTruthy());
});

test("the tailnet test asks for 10 minutes", async () => {
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return Response.json({ id: "c1" }, { status: 202 });
  }) as typeof fetch;
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: ["Home"], link_encrypted: true }} />);
  fireEvent.click(view.getByRole("button", { name: "Test the tailnet path for 10 minutes" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(JSON.parse(bodies[0]!)).toEqual({ kind: "prefer_tailnet", minutes: 10 });
});
