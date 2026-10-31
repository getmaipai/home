import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { api, type Roster } from "@/lib/api";
import { useAmbientCompanion } from "@/shell/useAmbientCompanion";

const person = { id: "person-1", display_name: "Person", role: "adult" } as Roster;
const companion = { id: "companion-1", name: "Companion", type: "adult", type_label: "Adult", tagline: "Calm", who_can_use: "Everyone", dials: [], voice: "", is_default: true, is_household: false, portrait: null, status: "ready", chats: 0, can_edit: false, can_copy: false };
const secondCompanion = { ...companion, id: "companion-2", name: "Other Companion", is_default: false };
const row = (over: Record<string, unknown> = {}) => ({ id: "task-1", kind: "picture", title: "Picture", state: "waiting", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-27T10:00:00Z", needs_you: true, waiting_reason: "Choose a size", ...over });

function Probe() {
  const ambient = useAmbientCompanion(person);
  const location = useLocation();
  return <><span data-testid="where">{location.pathname}{location.search}</span>{ambient ? <><span>{ambient.companion.name}</span><span>{ambient.action?.label ?? "No review"}</span>{ambient.action ? <button type="button" onClick={ambient.action.onClick}>Review</button> : null}</> : <span>Off</span>}</>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/media"]}><Probe /></MemoryRouter></QueryClientProvider>);
}
function stubApi(settings: Array<{ key: string; value: unknown }>, activity: unknown[] = []) {
  spyOn(api, "settingsValues").mockResolvedValue(settings as never);
  spyOn(api, "companions").mockResolvedValue({ allowed: true, can_create: false, can_discover: false, default_id: "companion-1", companions: [companion], discover: [] } as never);
  spyOn(api, "companionAvatar").mockResolvedValue({ avatar: null } as never);
  return spyOn(api, "companionActivity").mockResolvedValue({ activity: activity as never });
}

afterEach(() => { cleanup(); mock.restore(); });

describe("useAmbientCompanion", () => {
  test.each([
    [{ key: "companions.dock", value: false }],
    [{ key: "companions.allowed", value: false }],
  ])("is off when the ambient setting is disabled", async (setting) => {
    stubApi([setting]);
    const view = mount();
    await waitFor(() => expect(view.getByText("Off")).toBeTruthy());
    expect(view.queryByText("Companion")).toBeNull();
  });

  test("Review appears only for a viewer-owned non-chat row that needs them", async () => {
    stubApi([], [row({ id: "not-yet", needs_you: false }), row()]);
    const view = mount();
    await waitFor(() => expect(view.getByRole("button", { name: "Review" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Review" }));
    expect(view.getByTestId("where").textContent).toBe("/companions/companion-1?tab=tasks&task=task-1");
  });

  test("chat activity never raises Review", async () => {
    stubApi([], [row({ kind: "chat" })]);
    const view = mount();
    await waitFor(() => expect(view.getByText("No review")).toBeTruthy());
    expect(view.queryByRole("button", { name: "Review" })).toBeNull();
  });

  test("waits for the person's selection before resolving a different household default", async () => {
    let resolveSettings!: (value: unknown) => void;
    spyOn(api, "settingsValues").mockImplementation(() => new Promise((resolve) => { resolveSettings = resolve; }) as never);
    spyOn(api, "companions").mockResolvedValue({ allowed: true, can_create: false, can_discover: false, default_id: "companion-1", companions: [companion, secondCompanion], discover: [] } as never);
    spyOn(api, "companionAvatar").mockResolvedValue({ avatar: null } as never);
    spyOn(api, "companionActivity").mockResolvedValue({ activity: [] } as never);
    const view = mount();
    await waitFor(() => expect(resolveSettings).toBeFunction());
    expect(view.queryByText("Companion")).toBeNull();
    expect(view.queryByText("Other Companion")).toBeNull();
    resolveSettings([{ key: "persona.active_id", value: "companion-2" }, { key: "companions.allowed", value: true }, { key: "companions.dock", value: true }]);
    await waitFor(() => expect(view.getByText("Other Companion")).toBeTruthy());
    expect(view.queryByText("Companion")).toBeNull();
  });
});
