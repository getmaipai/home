import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RobotActions, robotHasDance } from "@/apps/settings/RobotActions";
import { checkinFacts } from "@/apps/settings/HouseholdRobotsSection";
import type { DeviceInfo } from "@/lib/api";

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

function robot(over: Partial<DeviceInfo> = {}): DeviceInfo {
  return { id: "robot-1", kind: "robot", name: "Rivet", area: null, lastSeenAt: null, createdAt: "2026-11-13T00:00:00.000Z", capabilities: ["light_ring", "head_pan_tilt", "speaker"], state: { activity: "idle", muted: false, tracking: false, reachable: true, unreachableSince: null }, ...over } as DeviceInfo;
}

describe("STACKCHAN-HOME-01 robot actions", () => {
  test("Dance, Test music detection and Announce send the typed commands", async () => {
    const sent: unknown[] = [];
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return Response.json({ id: "c1" }, { status: 202 }); }) as typeof fetch;
    const view = render(<RobotActions device={robot()} />);
    fireEvent.click(view.getByRole("button", { name: "Dance" }));
    await view.findByText("Asked Rivet to dance.");
    fireEvent.click(view.getByRole("button", { name: "Test music detection" }));
    await view.findByText(/Started the music check on Rivet/);
    const announce = view.getAllByRole("button", { name: "Announce" })[0] as HTMLButtonElement;
    expect(announce.disabled).toBe(true);
    fireEvent.change(view.getByRole("textbox"), { target: { value: " Dinner is ready " } });
    fireEvent.click(view.getByRole("switch"));
    fireEvent.click(view.getAllByRole("button", { name: "Announce" })[0]!);
    await view.findByText("Sent the announcement to Rivet.");
    expect(sent).toEqual([{ kind: "dance" }, { kind: "music_test" }, { kind: "announce", text: "Dinner is ready", urgent: true }]);
  });

  test("an unreachable robot cannot be sent anything, and a failure says what to do", async () => {
    const offline = render(<RobotActions device={robot({ state: { activity: "idle", muted: false, tracking: false, reachable: false, unreachableSince: "2026-11-13T00:00:00Z" } })} />);
    expect((offline.getByRole("button", { name: "Dance" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Only an adult who owns this robot, or an admin, can do that." }), { status: 403 })) as unknown as typeof fetch;
    const view = render(<RobotActions device={robot()} />);
    fireEvent.click(view.getByRole("button", { name: "Test music detection" }));
    expect((await view.findByRole("alert")).textContent).toContain("Only an adult");
  });

  test("a body without the light ring and head shows nothing, and the check-in facts read plainly", () => {
    expect(robotHasDance(robot({ capabilities: ["speaker"] }))).toBe(false);
    expect(render(<RobotActions device={robot({ capabilities: ["speaker"] })} />).queryByTestId("robot-actions")).toBeNull();
    expect(checkinFacts({ timers_active: 2, self_restarts: 1, heal_hold: true, mic_level: 40 })).toEqual(["Timers: 2", "Restarted itself 1 time", "Restart guard is holding", "Microphone level 40"]);
    expect(checkinFacts({ timers_active: null, heal_hold: false })).toEqual([]);
    expect(checkinFacts(null)).toEqual([]);
  });
});
