import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { api, type Roster } from "@/lib/api";
import { IncognitoProvider } from "@/shell/incognitoContext";
import { writeIncognitoCache } from "@/shell/incognitoCache";
import { useAmbientCompanion } from "@/shell/useAmbientCompanion";

const person = { id: "person-1", display_name: "Person", role: "adult" } as Roster;
const companion = { id: "companion-1", name: "Marlow Companion", type: "adult", type_label: "Adult", tagline: "Calm", who_can_use: "Everyone", dials: [], voice: "", is_default: true, is_household: false, portrait: "" };

function Probe() {
  const ambient = useAmbientCompanion(person);
  return <span data-testid="state">{ambient === undefined ? "loading" : ambient === null ? "none" : ambient.kind === "companion" ? ambient.companion.name : ambient.kind}</span>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><IncognitoProvider><MemoryRouter initialEntries={["/chat"]}><Probe /></MemoryRouter></IncognitoProvider></QueryClientProvider>);
}

function stubApi() {
  spyOn(api, "settingsValues").mockResolvedValue([] as never);
  const companions = spyOn(api, "companions").mockResolvedValue({ allowed: true, can_create: false, can_discover: false, default_id: "companion-1", companions: [companion], discover: [] } as never);
  const avatar = spyOn(api, "companionAvatar").mockResolvedValue({ avatar: null } as never);
  const robots = spyOn(api, "robotDevices").mockResolvedValue([] as never);
  const activity = spyOn(api, "companionActivity").mockResolvedValue({ activity: [] } as never);
  return { companions, avatar, robots, activity };
}

beforeEach(() => { try { localStorage.setItem("maipai.incognito-explanation-seen", "true"); } catch { /* ignore */ } });
afterEach(() => { cleanup(); mock.restore(); writeIncognitoCache(false); });

describe("useAmbientCompanion and Incognito", () => {
  test("with Incognito off the selected companion shows", async () => {
    writeIncognitoCache(false);
    stubApi();
    const view = mount();
    await waitFor(() => expect(view.getByTestId("state").textContent).toBe("Marlow Companion"));
  });

  test("with Incognito on no companion shows and none of its data is read", async () => {
    writeIncognitoCache(true);
    const calls = stubApi();
    const view = mount();
    await waitFor(() => expect(view.getByTestId("state").textContent).toBe("none"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.getByTestId("state").textContent).toBe("none");
    expect(calls.companions).not.toHaveBeenCalled();
    expect(calls.avatar).not.toHaveBeenCalled();
    expect(calls.robots).not.toHaveBeenCalled();
    expect(calls.activity).not.toHaveBeenCalled();
  });
});
