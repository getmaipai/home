import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { DevicesSection } from "@/apps/settings/DevicesSection";
import { Card } from "@maipai/ui/src/dashboard/components/ui/card";
import { bodyHealthText, didPutDownCountIncrease, RobotBody } from "@/apps/settings/RobotBody";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ApiError, type DeviceInfo, type SessionInfo } from "@/lib/api";
import { MemoryRouter } from "react-router-dom";

function settingsFetch(extra: boolean, patchCalls: unknown[] = [], patchError?: string) {
  const original = globalThis.fetch;
  const baseRegistry = ["robot.barge_in.open_mic", "robot.camera.watch_level", "robot.follow_up.seconds", "robot.gestures.enabled", "robot.idle.level", "robot.initiative.allowed_here", "robot.face.color", "robot.night.mode"].map((key) => ({ key, scope: "device", selector: key.endsWith("seconds") ? "number" : key.endsWith("level") || key === "robot.face.color" ? "select" : "boolean", default: key.endsWith("seconds") ? 10 : key === "robot.face.color" ? "mint" : key === "robot.night.mode", range: key === "robot.face.color" ? { options: ["mint", "sky", "peach", "lavender", "lemon", "rose", "cloud"] } : undefined, label: key === "robot.face.color" ? "Face color" : key === "robot.night.mode" ? "Night mode" : key, help: "Registry-provided help.", level: "basic", secret: false, lives_in: "robot.hello", honoured_by: ["home"] }));
  baseRegistry.push({ key: "robot.voice.id", scope: "device", selector: "select", range: { options_from: "voices.tts" }, default: "default", label: "Voice", help: "Robot voice.", level: "basic", secret: false, lives_in: "robot.hello", honoured_by: ["home"] } as never);
  const registry = [...baseRegistry, ...(extra ? [{ ...baseRegistry[0]!, key: "robot.hello.future", label: "robot.hello.future" }] : [])];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.endsWith("/api/voice/voices")) return Promise.resolve(Response.json({ voices: [{ id: "pocket-tts-voice-alba", name: "Alba", description: "", language: "en", country: "", gender: "", source: "preset", engine: "pocket", onDisk: true, licence: null, revision: "test" }, { id: "community-test", name: "Community", description: "", language: "en", country: "", gender: "", source: "community", engine: "pocket", onDisk: true, licence: null, revision: "test" }] }));
    if (url.includes("/api/settings?scope=device%3Arobot-1")) return Promise.resolve(Response.json(registry.map((row) => ({ key: row.key, value: row.default, source: "default", label: row.label, help: row.help, level: row.level, secret: false }))));
    if (url.endsWith("/api/settings") && init?.method === "PUT") {
      patchCalls.push(JSON.parse(String(init.body)));
      return Promise.resolve(Response.json({ key: "robot.follow_up.seconds", value: 12, source: "user", label: "Follow up seconds", level: "basic", secret: false }));
    }
    if (url.endsWith("/api/devices/robot-1") && init?.method === "PATCH") {
      patchCalls.push(JSON.parse(String(init.body)));
      if (patchError) return Promise.resolve(Response.json({ error: patchError }, { status: 409 }));
      return Promise.resolve(Response.json({ ...device({ id: "robot-1", kind: "robot" }), name: "Renamed" }));
    }
    throw new Error(`unstubbed settings fetch: ${url} (${init?.method ?? "GET"})`);
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

afterEach(cleanup);

function device(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: "device-abc123",
    kind: "phone",
    name: "Nova's phone",
    area: null,
    lastSeenAt: "2026-09-06T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    capabilities: [],
    ...overrides,
  };
}

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "sess-abc123",
    userAgent: "Safari on iPhone",
    createdAt: "2026-09-05T00:00:00.000Z",
    expiresAt: "2026-10-05T00:00:00.000Z",
    isCurrent: false,
    ...overrides,
  };
}

function renderSection() {
  return renderWithQueryClient(<DevicesSection person={{ id: "person-1", role: "adult" } as never} />);
}

function stubFetch(
  devices: DeviceInfo[],
  sessions: SessionInfo[],
  onAction: (kind: "device" | "session", id: string) => void = () => {},
  onCommand: (id: string, body: unknown) => void = () => {},
): () => void {
  let deviceRows = devices;
  let sessionRows = sessions;
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const deviceCommand = url.match(/\/api\/devices\/([^/]+)\/commands$/);
    if (deviceCommand && method === "POST") {
      onCommand(deviceCommand[1]!, JSON.parse(String(init?.body)) as unknown);
      return Promise.resolve(new Response(JSON.stringify({ id: "command-1" }), { status: 202 }));
    }
    const scopeEdit = url.match(/\/api\/devices\/([^/]+)\/offline-scope$/);
    if (scopeEdit && method === "PATCH") {
      const { offline_scope } = JSON.parse(String(init?.body)) as { offline_scope: DeviceInfo["offlineScope"] };
      deviceRows = deviceRows.map((row) => row.id === scopeEdit[1] ? { ...row, offlineScope: offline_scope } : row);
      return Promise.resolve(Response.json({ success: true }));
    }
    const deviceDelete = url.match(/\/api\/devices\/([^/]+)$/);
    if (deviceDelete && method === "DELETE") {
      onAction("device", deviceDelete[1]!);
      deviceRows = deviceRows.filter((d) => d.id !== deviceDelete[1]);
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }
    const sessionDelete = url.match(/\/api\/auth\/sessions\/([^/]+)$/);
    if (sessionDelete && method === "DELETE") {
      onAction("session", sessionDelete[1]!);
      sessionRows = sessionRows.filter((s) => s.id !== sessionDelete[1]);
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    }
    if (url.endsWith("/api/devices")) return Promise.resolve(new Response(JSON.stringify(deviceRows), { status: 200 }));
    if (url.endsWith("/api/auth/sessions")) return Promise.resolve(new Response(JSON.stringify(sessionRows), { status: 200 }));
    throw new Error(`unstubbed fetch: ${url} (${method})`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

describe("DevicesSection", () => {
  test("put-down change detection requires an increase between two reads", () => {
    expect(didPutDownCountIncrease(undefined, 1)).toBe(false);
    expect(didPutDownCountIncrease(1, 1)).toBe(false);
    expect(didPutDownCountIncrease(2, 1)).toBe(false);
    expect(didPutDownCountIncrease(1, 2)).toBe(true);
  });
  test("body health says nothing when fine and names a latched motor or heat", () => {
    const base = { activity: "idle", muted: false, tracking: false, reachable: true, unreachableSince: null } as const;
    expect(bodyHealthText({ ...base })).toBeNull();
    expect(bodyHealthText({ ...base, motors_latched: [], thermal: { level: "nominal", temp_c: 40, vision_hz: 15, fault: false } })).toBeNull();
    expect(bodyHealthText({ ...base, motors_latched: ["antenna_left"] })).toContain("antenna_left");
    expect(bodyHealthText({ ...base, thermal: { level: "gestures_suspended", temp_c: 76, vision_hz: 2, fault: false } })).toContain("gestures paused");
  });
  test("robot Settings is admin only and draws all registry keys from robot device cards", async () => {
    const restore = settingsFetch(true);
    try {
      const admin = renderWithQueryClient(<MemoryRouter><Card><RobotBody device={device({ id: "robot-1", kind: "robot", name: "Riff" })} viewerRole="admin" onRemove={() => {}} confirmingRemove={false} onConfirmRemove={() => {}} onCancelRemove={() => {}} busy={false} onSetMuted={async () => {}} onStartLiveView={async () => ({ view_id: "v", stream: "" })} onStopLiveView={async () => {}} onAnswerMotorReboot={async () => {}} /></Card></MemoryRouter>);
      fireEvent.click(admin.getByRole("button", { name: "Settings" }));
      await admin.findByText("robot.hello.future");
      expect(admin.getByText("robot.barge_in.open_mic")).toBeTruthy();
      expect(admin.getByText("Face color")).toBeTruthy();
      expect(admin.getByText("Night mode")).toBeTruthy();
      cleanup();
      const adult = renderWithQueryClient(<Card><RobotBody device={device({ id: "robot-1", kind: "robot", name: "Riff" })} viewerRole="adult" onRemove={() => {}} confirmingRemove={false} onConfirmRemove={() => {}} onCancelRemove={() => {}} busy={false} onSetMuted={async () => {}} onStartLiveView={async () => ({ view_id: "v", stream: "" })} onStopLiveView={async () => {}} onAnswerMotorReboot={async () => {}} /></Card>);
      expect(adult.queryByRole("button", { name: "Settings" })).toBeNull();
    } finally { restore(); }
  });

  test("robot Voice row lists mocked voices with Same as its person first", async () => {
    const restore = settingsFetch(false);
    try {
      const view = renderWithQueryClient(<MemoryRouter><Card><RobotBody device={device({ id: "robot-1", kind: "robot", name: "Riff" })} viewerRole="admin" onRemove={() => {}} confirmingRemove={false} onConfirmRemove={() => {}} onCancelRemove={() => {}} busy={false} onSetMuted={async () => {}} onStartLiveView={async () => ({ view_id: "v", stream: "" })} onStopLiveView={async () => {}} onAnswerMotorReboot={async () => {}} /></Card></MemoryRouter>);
      fireEvent.click(view.getByRole("button", { name: "Settings" }));
      await view.findByText("Voice");
      fireEvent.click(view.getByRole("combobox", { name: "Voice" }));
      const choices = await view.findAllByRole("option");
      expect(choices.map((choice) => choice.textContent)).toEqual(["Same as its person", "Alba"]);
    } finally { restore(); }
  });

  test("robot self tests show only reported parts, disable offline, and render pass and timeout results", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { part?: string };
      if (body.part === "speaker") return Promise.resolve(Response.json({ run_id: "r1", part: "speaker", ok: true, detail: "Clear sound", took_ms: 10 }));
      return Promise.resolve(new Response(JSON.stringify({ code: "robot_no_answer", error: "The robot did not answer the test. Restart it, then try again." }), { status: 504 }));
    }) as unknown as typeof fetch;
    try {
      const view = render(<Card><RobotBody device={device({ id: "robot-test", kind: "robot", capabilities: ["speaker", "head_pan_tilt"], state: { activity: "idle", muted: false, tracking: false, reachable: true, unreachableSince: null } })} viewerRole="admin" onRemove={() => {}} confirmingRemove={false} onConfirmRemove={() => {}} onCancelRemove={() => {}} busy={false} onSetMuted={async () => {}} onStartLiveView={async () => ({ view_id: "v", stream: "" })} onStopLiveView={async () => {}} onAnswerMotorReboot={async () => {}} /></Card>);
      expect(view.queryByRole("button", { name: "Face" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Speaker" }));
      await view.findByText("Passed");
      fireEvent.click(view.getByRole("button", { name: "Head" }));
      await view.findByRole("alert");

      cleanup();
      const offline = render(<Card><RobotBody device={device({ id: "robot-offline", kind: "robot", capabilities: ["speaker"], state: { activity: "idle", muted: false, tracking: false, reachable: false, unreachableSince: "2026-10-20T10:00:00Z" } })} viewerRole="admin" onRemove={() => {}} confirmingRemove={false} onConfirmRemove={() => {}} onCancelRemove={() => {}} busy={false} onSetMuted={async () => {}} onStartLiveView={async () => ({ view_id: "v", stream: "" })} onStopLiveView={async () => {}} onAnswerMotorReboot={async () => {}} /></Card>);
      expect((offline.getByRole("button", { name: "Speaker" }) as HTMLButtonElement).disabled).toBe(true);
    } finally { globalThis.fetch = original; }
  });

  test("saving robot name calls the device PATCH route", async () => {
    const calls: unknown[] = [];
    const restore = settingsFetch(false, calls);
    try {
      const view = renderWithQueryClient(<MemoryRouter><Card><RobotBody device={device({ id: "robot-1", kind: "robot", name: "Riff" })} viewerRole="owner" onRemove={() => {}} confirmingRemove={false} onConfirmRemove={() => {}} onCancelRemove={() => {}} busy={false} onSetMuted={async () => {}} onStartLiveView={async () => ({ view_id: "v", stream: "" })} onStopLiveView={async () => {}} onAnswerMotorReboot={async () => {}} /></Card></MemoryRouter>);
      fireEvent.click(view.getByRole("button", { name: "Settings" }));
      const input = view.getByLabelText("Name");
      fireEvent.change(input, { target: { value: "Riff Two" } });
      fireEvent.click(view.getByRole("button", { name: "Save name and area" }));
      await waitFor(() => expect(calls).toContainEqual({ name: "Riff Two", area: null }));
    } finally { restore(); }
  });
  test("shows the duplicate robot name response under the name field", async () => {
    const restore = settingsFetch(false, [], "Another robot is already called StackChan. Pick a different name.");
    try {
      const view = renderWithQueryClient(<MemoryRouter><Card><RobotBody device={device({ id: "robot-1", kind: "robot", name: "Riff" })} viewerRole="owner" onRemove={() => {}} confirmingRemove={false} onConfirmRemove={() => {}} onCancelRemove={() => {}} busy={false} onSetMuted={async () => {}} onStartLiveView={async () => ({ view_id: "v", stream: "" })} onStopLiveView={async () => {}} onAnswerMotorReboot={async () => {}} /></Card></MemoryRouter>);
      fireEvent.click(view.getByRole("button", { name: "Settings" }));
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "StackChan" } });
      fireEvent.click(view.getByRole("button", { name: "Save name and area" }));
      expect(await view.findByRole("alert")).toHaveTextContent("Another robot is already called StackChan. Pick a different name.");
      expect(view.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    } finally { restore(); }
  });
  test("empty devices and sessions say so, not a blank page", async () => {
    const restore = stubFetch([], []);
    try {
      const { findByText } = renderSection();
      await findByText("No devices paired to your profile yet.");
      await findByText("No active sessions.");
    } finally {
      restore();
    }
  });

  test("shows a device's kind, name and last-seen time", async () => {
    const restore = stubFetch([device({ kind: "tv", name: "Living room TV" })], []);
    try {
      const { findByText } = renderSection();
      await findByText("Living room TV");
      await findByText("TV");
    } finally {
      restore();
    }
  });

  test("the current session has no sign-out button; another session does", async () => {
    const restore = stubFetch(
      [],
      [session({ id: "sess-current", isCurrent: true, userAgent: "This browser" }), session({ id: "sess-other", userAgent: "Other browser" })],
    );
    try {
      const { findByText, queryByRole, findByRole } = renderSection();
      await findByText("This browser");
      expect(queryByRole("button", { name: /Sign out This browser/ })).toBeNull();
      await findByRole("button", { name: "Sign out Other browser" });
    } finally {
      restore();
    }
  });

  test("removing a device asks first, then calls the real revoke route", async () => {
    const actions: Array<[string, string]> = [];
    const restore = stubFetch([device({ id: "device-1", name: "Old tablet" })], [], (kind, id) => actions.push([kind, id]));
    try {
      const { findByRole, findByText } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Remove Old tablet" }));
      await findByText(/Remove Old tablet\?/);
      fireEvent.click(await findByRole("button", { name: "Yes, remove it" }));
      await waitFor(() => expect(actions).toEqual([["device", "device-1"]]));
    } finally {
      restore();
    }
  });

  test("signing out a session asks first, then calls the real revoke route", async () => {
    const actions: Array<[string, string]> = [];
    const restore = stubFetch([], [session({ id: "sess-1", userAgent: "Old laptop" })], (kind, id) => actions.push([kind, id]));
    try {
      const { findByRole, findByText } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Sign out Old laptop" }));
      await findByText(/Sign out Old laptop\?/);
      fireEvent.click(await findByRole("button", { name: "Yes, sign it out" }));
      await waitFor(() => expect(actions).toEqual([["session", "sess-1"]]));
    } finally {
      restore();
    }
  });

  test("a robot shows its live state on a card, not a plain row", async () => {
    const restore = stubFetch(
      [
        device({
          id: "robot-1",
          kind: "robot",
          name: "Riff",
          state: {
            activity: "listening",
            muted: true,
            tracking: false,
            on_battery: null,
            battery_level: null,
            daemon_version: "1.4.2",
            app_version: "0.1.0",
            reachable: true,
            unreachableSince: null,
          },
        }),
      ],
      [],
    );
    try {
      const { findByTestId } = renderSection();
      const card = await findByTestId("robot-card");
      expect(card.textContent).toContain("Muted");
      expect(card.textContent).toContain("Level unknown");
      expect(card.textContent).toContain("MaiPai version");
      expect(card.textContent).toContain("0.1.0");
      expect(card.textContent).toContain("Body software");
      expect(card.textContent).toContain("1.4.2");
      expect(card.textContent).not.toContain("Software version");
    } finally {
      restore();
    }
  });

  test("a paired robot shows plain capability labels and keeps unknown ids visible", async () => {
    const capabilities = [
      "lease",
      "estop",
      "head_pan_tilt",
      "light_ring",
      "speaker",
      "camera",
      "battery_readout",
      "speech_pod",
      "future_capability",
    ];
    const restore = stubFetch(
      [
        device({
          id: "stackchan-1",
          kind: "robot",
          name: "Riff",
          capabilities,
          state: { activity: "idle", muted: false, tracking: true, reachable: true, unreachableSince: null },
        }),
      ],
      [],
    );
    try {
      const { findByTestId } = renderSection();
      const card = await findByTestId("robot-card");
      for (const label of [
        "Motion control",
        "Emergency stop",
        "Head turns and nods",
        "Light ring",
        "Speaker",
        "Camera",
        "Battery level",
        "Speaks through Home",
        "future_capability",
      ]) {
        expect(card.textContent).toContain(label);
      }
      expect(card.textContent).toContain("Paired");
      expect(card.textContent).toContain("Ready");
    } finally {
      restore();
    }
  });

  test("new robot activities render their plain status labels", async () => {
    const restore = stubFetch(
      [
        device({
          id: "robot-reconnecting",
          kind: "robot",
          name: "Riff reconnecting",
          state: { activity: "reconnecting", muted: false, tracking: true, reachable: true, unreachableSince: null },
        }),
        device({
          id: "robot-sleeping",
          kind: "robot",
          name: "Riff sleeping",
          state: { activity: "sleeping", muted: false, tracking: true, reachable: true, unreachableSince: null },
        }),
      ],
      [],
    );
    try {
      const { findByText } = renderSection();
      await findByText("Reconnecting");
      await findByText("Sleeping");
    } finally {
      restore();
    }
  });

  test("held robots show a plain carrying label", async () => {
    const restore = stubFetch([device({
      kind: "robot",
      name: "Reachy",
      state: { activity: "idle", muted: false, tracking: true, motion: "held", put_down_count: 1, reachable: true, unreachableSince: null },
    })], []);
    try {
      const { findByText, findByTestId } = renderSection();
      await findByText("Being carried");
      const card = await findByTestId("robot-card");
      expect(card.textContent).not.toContain("Reachy was moved.");
    } finally {
      restore();
    }
  });

  test("a robot that stopped reporting says not responding and since when", async () => {
    const restore = stubFetch(
      [
        device({
          kind: "robot",
          name: "Riff",
          state: {
            activity: "idle",
            muted: false,
            tracking: true,
            battery_level: 0.5,
            daemon_version: null,
            reachable: false,
            unreachableSince: "2026-09-29T10:00:00.000Z",
          },
        }),
      ],
      [],
    );
    try {
      const { findByText, findByTestId } = renderSection();
      await findByText("Not responding");
      const card = await findByTestId("robot-card");
      expect(card.textContent).toContain("Last heard from");
      expect(card.textContent).toContain("MaiPai versionUnknown");
      expect(card.textContent).toContain("Body softwareUnknown");
      expect(card.textContent).toContain("50%");
    } finally {
      restore();
    }
  });

  test("a robot with no report yet says it is waiting", async () => {
    const restore = stubFetch([device({ kind: "robot", name: "Riff", state: null })], []);
    try {
      const { findByText } = renderSection();
      await findByText("Waiting for first report");
    } finally {
      restore();
    }
  });

  test("removing a robot from its card asks first, then calls the revoke route", async () => {
    const actions: Array<[string, string]> = [];
    const restore = stubFetch([device({ id: "robot-1", kind: "robot", name: "Riff", state: null })], [], (kind, id) => actions.push([kind, id]));
    try {
      const { findByRole } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Remove Riff" }));
      fireEvent.click(await findByRole("button", { name: "Yes, remove it" }));
      await waitFor(() => expect(actions).toEqual([["device", "robot-1"]]));
    } finally {
      restore();
    }
  });

  test("a robot card sends a mute command to the authenticated hub route", async () => {
    const commands: Array<[string, unknown]> = [];
    const restore = stubFetch([device({
      id: "robot-mute",
      kind: "robot",
      name: "Riff",
      state: { activity: "idle", muted: false, tracking: false, reachable: true, unreachableSince: null },
    })], [], () => {}, (id, body) => commands.push([id, body]));
    try {
      const { findByRole } = renderSection();
      fireEvent.click(await findByRole("button", { name: "Mute microphone" }));
      await waitFor(() => expect(commands).toEqual([["robot-mute", { kind: "mute" }]]));
    } finally {
      restore();
    }
  });

  test("a robot error retry resends the existing mute request", async () => {
    let calls = 0;
    const onSetMuted = mock(async (_muted: boolean) => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
    });
    const view = render(<Card><RobotBody
      device={device({
        id: "robot-mute-retry",
        kind: "robot",
        name: "Riff",
        state: { activity: "idle", muted: false, tracking: false, reachable: true, unreachableSince: null },
      })}
      onRemove={() => {}}
      confirmingRemove={false}
      onConfirmRemove={() => {}}
      onCancelRemove={() => {}}
      busy={false}
      onSetMuted={onSetMuted}
      onStartLiveView={async () => ({ view_id: "view-1", stream: "/api/devices/live-view/view-1" })}
      onStopLiveView={async () => {}}
      onAnswerMotorReboot={async () => {}}
    /></Card>);
    fireEvent.click(view.getByRole("button", { name: "Mute microphone" }));
    await view.findByRole("alert");
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSetMuted).toHaveBeenCalledTimes(2));
    expect(onSetMuted).toHaveBeenNthCalledWith(1, true);
    expect(onSetMuted).toHaveBeenNthCalledWith(2, true);
    expect(view.queryByRole("alert")).toBeNull();
  });
  function rebootCard(answer: (a: "yes" | "no") => Promise<void>, offer: string[] | null = ["stewart_3"], reachable = true) {
    return render(<Card><RobotBody
      device={device({
        id: "robot-reboot",
        kind: "robot",
        name: "Riff",
        state: { activity: "idle", muted: false, tracking: false, reachable, unreachableSince: null, motors_latched: ["body_yaw", "stewart_3"], ...(offer ? { motors_reboot_offer: offer } : {}) },
      })}
      onRemove={() => {}}
      confirmingRemove={false}
      onConfirmRemove={() => {}}
      onCancelRemove={() => {}}
      busy={false}
      onSetMuted={async () => {}}
      onStartLiveView={async () => ({ view_id: "view-1", stream: "/api/devices/live-view/view-1" })}
      onStopLiveView={async () => {}}
      onAnswerMotorReboot={answer}
    /></Card>);
  }

  test("a motor reboot offer names the latched motors and sends nothing until yes", async () => {
    const answers: string[] = [];
    const view = rebootCard(async (a) => { answers.push(a); });
    expect(view.getByTestId("motor-reboot-offer").textContent).toContain("stewart_3");
    expect(view.getByTestId("motor-reboot-offer").textContent).toContain("Restart Riff");
    expect(answers).toEqual([]);
    fireEvent.click(view.getByRole("button", { name: "Yes, restart it" }));
    await waitFor(() => expect(answers).toEqual(["yes"]));
  });

  test("answering no sends no and the plain refusal from the hub is shown", async () => {
    const answers: string[] = [];
    const view = rebootCard(async (a) => { answers.push(a); throw new ApiError("Only an adult can restart a robot's motor. Ask an adult to answer this.", 403); });
    fireEvent.click(view.getByRole("button", { name: "No, leave it" }));
    await view.findByText(/Only an adult can restart/);
    expect(answers).toEqual(["no"]);
  });

  test("no offer, or a robot that is not responding, shows no reboot question", () => {
    expect(rebootCard(async () => {}, null).queryByRole("button", { name: "Yes, restart it" })).toBeNull();
    cleanup();
    expect(rebootCard(async () => {}, [], true).queryByRole("button", { name: "Yes, restart it" })).toBeNull();
    cleanup();
    expect(rebootCard(async () => {}, ["stewart_3"], false).queryByRole("button", { name: "Yes, restart it" })).toBeNull();
  });

  function liveCard(start: () => Promise<{ view_id: string; stream: string }>, stop: (id: string) => Promise<void>) {
    return render(<Card><RobotBody
      device={device({
        id: "robot-live",
        kind: "robot",
        name: "Riff",
        state: { activity: "idle", muted: false, tracking: false, reachable: true, unreachableSince: null },
      })}
      onRemove={() => {}}
      confirmingRemove={false}
      onConfirmRemove={() => {}}
      onCancelRemove={() => {}}
      busy={false}
      onSetMuted={async () => {}}
      onStartLiveView={start}
      onStopLiveView={stop}
      onAnswerMotorReboot={async () => {}}
    /></Card>);
  }

  test("the live view button opens the hub stream and stop closes it", async () => {
    const stopped: string[] = [];
    const view = liveCard(
      async () => ({ view_id: "view-9", stream: "/api/devices/live-view/view-9" }),
      async (id) => { stopped.push(id); },
    );
    fireEvent.click(view.getByRole("button", { name: "Live view" }));
    // happy-dom cannot load a stream, so the kit preview shows its broken-image state here; the real
    // <img src> is checked in the browser screenshot. What matters here is the view's own lifecycle.
    await view.findByTestId("robot-live-view");
    fireEvent.click(view.getByRole("button", { name: "Stop live view" }));
    expect(stopped).toEqual(["view-9"]);
    expect(view.queryByTestId("robot-live-view")).toBeNull();
    view.unmount();
    expect(stopped).toEqual(["view-9"]);
  });

  test("closing the card while a live view is open stops it", async () => {
    const stopped: string[] = [];
    const view = liveCard(
      async () => ({ view_id: "view-10", stream: "/api/devices/live-view/view-10" }),
      async (id) => { stopped.push(id); },
    );
    fireEvent.click(view.getByRole("button", { name: "Live view" }));
    await view.findByTestId("robot-live-view");
    view.unmount();
    expect(stopped).toEqual(["view-10"]);
  });

  test("a refused live view shows the hub's own reason and no image", async () => {
    const view = liveCard(
      async () => { throw new ApiError("Live view is off. An admin can turn it on in the robot settings.", 403); },
      async () => {},
    );
    fireEvent.click(view.getByRole("button", { name: "Live view" }));
    expect((await view.findByRole("alert")).textContent).toContain("Live view is off");
    expect(view.queryByTestId("robot-live-view")).toBeNull();
    expect(view.getByRole("button", { name: "Live view" })).toBeTruthy();
  });
});

test("a device owner can toggle offline permission and sees Remove all for this browser", async () => {
  const restore = stubFetch([device({ offlineScope: [] })], []);
  try {
    const view = renderSection();
    const permission = await view.findByRole("switch", { name: "Can keep copies on this device" });
    expect(permission).not.toBeChecked();
    fireEvent.click(permission);
    await waitFor(() => expect(permission).toBeChecked());
    expect(view.getByRole("button", { name: "Remove all offline copies" })).toBeInTheDocument();
  } finally { restore(); }
});

test("robots, TVs and pods show no keep-media switch", async () => {
  const restore = stubFetch([device({ id: "device-robot0001", kind: "robot", offlineScope: [] }), device({ id: "device-tv000001", kind: "tv", offlineScope: [] })], []);
  try {
    const view = renderSection();
    await view.findByText(/TV/i);
    expect(view.queryByRole("switch", { name: "Can keep copies on this device" })).toBeNull();
  } finally { restore(); }
});


test("kept copies show their record kind, including equal ids in different kinds", async () => {
  const { setMediaOwner } = await import("@/lib/offlineMedia");
  const previousCaches = globalThis.caches;
  const restoreFetch = stubFetch([], []);
  const manifests = ["media", "reference"].map((kind) => ({ kind, id: "nova", title: "nova", entries: [], total_bytes: 0, generated_at: new Date().toISOString() }));
  Object.assign(globalThis, { caches: { open: async () => ({
    keys: async () => manifests.map((m) => new Request(`https://example.com/api/media/offline/kept/${m.kind}/nova`)),
    match: async (key: Request) => Response.json(manifests.find((m) => key.url.includes(`/${m.kind}/nova`))),
  }) } });
  try {
    await setMediaOwner("person-atlas");
    const view = renderSection();
    expect(await view.findByText("Media")).toBeInTheDocument();
    expect(await view.findByText("reference")).toBeInTheDocument();
    expect(view.getAllByText("nova").length).toBe(2);
  } finally {
    await setMediaOwner(null);
    restoreFetch();
    if (previousCaches) Object.assign(globalThis, { caches: previousCaches }); else Reflect.deleteProperty(globalThis, "caches");
  }
});
