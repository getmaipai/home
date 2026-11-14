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

test("on the home link the add form shows behind a confirmation, and Add stays off until it is ticked", async () => {
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return Response.json({ sent: true }, { status: 202 });
  }) as typeof fetch;
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: [], link_encrypted: false, link_path: "home" }} />);
  expect(view.getByText(/This sends the password across your home network to the robot/)).toBeTruthy();
  fireEvent.change(view.getByLabelText("Network name"), { target: { value: "Phone" } });
  fireEvent.change(view.getByLabelText("Wi-Fi password"), { target: { value: "PrivateFixture987" } });
  const add = view.getByRole("button", { name: "Add network" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.click(view.getByRole("checkbox", { name: /This is my own home network/ }));
  expect(add.disabled).toBe(false);
  fireEvent.click(add);
  await waitFor(() => expect(bodies.length).toBe(1));
  expect(bodies[0]).toContain('"confirm_lan":true');
});

test("Show password reveals the field and hides it again", () => {
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: [], link_encrypted: true, link_path: "away" }} />);
  const field = view.getByLabelText("Wi-Fi password") as HTMLInputElement;
  expect(field.type).toBe("password");
  fireEvent.click(view.getByRole("checkbox", { name: "Show password" }));
  expect(field.type).toBe("text");
});

test("an unknown connection path shows no add form and says why", () => {
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: [], link_encrypted: false, link_path: "other" }} />);
  expect(view.queryByLabelText("Wi-Fi password")).toBeNull();
  expect(view.getByText(/not your home network or your tailnet/)).toBeTruthy();
});

test("on the encrypted tailnet link no confirmation is asked", async () => {
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return Response.json({ sent: true }, { status: 202 });
  }) as typeof fetch;
  const view = render(<RobotWifi deviceId="r1" checkin={{ wifi_saved: [], link_encrypted: true, link_path: "away" }} />);
  expect(view.queryByText(/This sends the password across your home network/)).toBeNull();
  fireEvent.change(view.getByLabelText("Network name"), { target: { value: "Phone" } });
  fireEvent.change(view.getByLabelText("Wi-Fi password"), { target: { value: "PrivateFixture987" } });
  fireEvent.click(view.getByRole("button", { name: "Add network" }));
  await waitFor(() => expect(bodies.length).toBe(1));
  expect(bodies[0]).not.toContain("confirm_lan");
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
