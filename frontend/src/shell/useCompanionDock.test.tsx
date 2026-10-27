import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CompanionDock } from "@maipai/ui/src/elements/companion-dock";
import { api, type Roster } from "@/lib/api";
import { useCompanionDock } from "@/shell/useCompanionDock";

const person = { id: "person-1", display_name: "Rivet", role: "adult" } as Roster;
const card = { id: "sage", name: "Sage", type: "adult", type_label: "Adult", tagline: "Calm", who_can_use: "Everyone", dials: [], voice: "", is_default: true, is_household: false, portrait: null, status: "ready", chats: 0, can_edit: false, can_copy: false };
const row = (over: Record<string, unknown> = {}) => ({ id: "t1", kind: "picture", title: "Poster", state: "waiting", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-27T10:00:00Z", needs_you: true, waiting_reason: "Pick a size", ...over });

function Probe() {
  const dock = useCompanionDock(person);
  const location = useLocation();
  return <><span data-testid="where">{location.pathname}{location.search}</span>{dock ? <CompanionDock {...dock} /> : null}</>;
}
function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Probe /></MemoryRouter></QueryClientProvider>);
}
function stubApi(settings: Array<{ key: string; value: unknown }>, activity: unknown[] = []) {
  spyOn(api, "settingsValues").mockResolvedValue(settings as never);
  spyOn(api, "companions").mockResolvedValue({ allowed: true, can_create: false, can_discover: false, default_id: "sage", companions: [card], discover: [] } as never);
  spyOn(api, "companionAvatar").mockResolvedValue({ avatar: null } as never);
  return spyOn(api, "companionActivity").mockResolvedValue({ activity: activity as never });
}

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); mock.restore(); });

describe("useCompanionDock", () => {
  test("shows the companion with no Review button when nothing needs the person", async () => {
    stubApi([]);
    const view = mount("/media");
    await view.findByText("Here when you need me.");
    expect(view.getByText("Sage")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Review" })).toBeNull();
  });

  test("draws nothing on Chat, and nothing when the dock or companions are off", async () => {
    stubApi([]);
    const chat = mount("/chat");
    await waitFor(() => expect(chat.getByTestId("where").textContent).toBe("/chat"));
    expect(chat.queryByText("Sage")).toBeNull();
    cleanup();
    stubApi([{ key: "companions.dock", value: false }]);
    const off = mount("/media");
    await waitFor(() => expect(api.settingsValues).toHaveBeenCalled());
    expect(off.queryByText("Sage")).toBeNull();
    cleanup();
    stubApi([{ key: "companions.allowed", value: false }]);
    const none = mount("/media");
    await waitFor(() => expect(api.settingsValues).toHaveBeenCalled());
    expect(none.queryByText("Sage")).toBeNull();
  });

  test("Review appears only for a row that needs the person and opens it in the Tasks tab", async () => {
    stubApi([], [row({ id: "t0", needs_you: false }), row()]);
    const view = mount("/media");
    fireEvent.click(await view.findByRole("button", { name: "Review" }));
    expect(view.getByText("Pick a size")).toBeTruthy();
    expect(view.getByTestId("where").textContent).toBe("/companions/sage?tab=tasks&task=t1");
  });

  test("a chat row never raises Review", async () => {
    stubApi([], [row({ kind: "chat", state: "done" })]);
    const view = mount("/media");
    await view.findByText("Here when you need me.");
    expect(view.queryByRole("button", { name: "Review" })).toBeNull();
  });

  test("close writes the setting off and minimize is remembered", async () => {
    stubApi([]);
    const set = spyOn(api, "setSetting").mockResolvedValue(undefined as never);
    const view = mount("/media");
    fireEvent.click(await view.findByRole("button", { name: "Minimize Sage" }));
    expect(view.queryByText("Here when you need me.")).toBeNull();
    expect(localStorage.getItem("maipai.companion.dock.minimized")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Show Sage" }));
    fireEvent.click(view.getByRole("button", { name: "Hide Sage" }));
    expect(set).toHaveBeenCalledWith("person:person-1", "companions.dock", false);
  });
});
