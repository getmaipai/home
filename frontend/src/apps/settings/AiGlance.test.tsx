import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MemoryRouter } from "react-router-dom";
import { AiGlance } from "@/apps/settings/AiGlance";
import { makePerson, REGISTRY } from "@/shell/pages/settings/settingsTestKit";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });
const mkLevel = (tier: string, state: string = "ready", label: string | null = "Qwen") => ({ tier, state, model_label: label, size_bytes_missing: state === "missing" ? 2e9 : null, detail: null, action: state === "missing" ? { kind: "download", label: "Install", job: "chat", level: tier } : null });
const rows = ["chat", "pictures", "videos", "music", "voice"].map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), used_by: ["chat"], levels: [mkLevel("reduced", "waits", null), mkLevel("standard"), mkLevel("boost", "same", null), mkLevel("max", "same", null)], ready_count: 1, level_count: 4 }));
const base = { features: rows, helpers: [], attention: { items: [], download_all: null }, right_now: { engine: "ready", waiting: 0, memory_free_bytes: 1e9, disk_free_bytes: 2e9, models_bytes: 3e9 } };
const candidates = { profile: "test", room_bytes: 10e9, levels: ["standard", "boost", "max"].map((tier) => ({ tier, cap_bytes: 10e9, recommended: "model-qwen", candidates: [{ id: "model-qwen", label: "Qwen", fits: true, refusal: null }, { id: "model-muse", label: "Muse Glimmer", fits: true, refusal: null }] })) };
function render(data = base, role = "owner") {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString(); calls.push({ url, init }); const path = url.split("?")[0]!;
    if (path.endsWith("/api/ai/overview")) return Promise.resolve(Response.json(data));
    if (path.includes("/api/ai/tiers/")) return Promise.resolve(Response.json({ profile: candidates.profile, room_bytes: candidates.room_bytes, levels: candidates.levels.map((level) => ({ ...level, candidates: level.candidates.map((item) => ({ ...item, family: "qwen", peak_bytes: 1e9, verified: true })) })) }));
    if (path === "/api/settings" && url.includes("scope=")) return Promise.resolve(Response.json(REGISTRY.filter((key) => key.scope === "household").map((key) => ({ key: key.key, value: key.key === "chat.paused" ? false : key.key.endsWith("tier.standard") ? { model: "model-qwen", who: "everyone", options: {} } : key.default ?? null, source: "default", label: key.label, help: key.help, level: key.level, secret: false }))));
    if (path === "/api/settings/registry") return Promise.resolve(Response.json(REGISTRY));
    if (path === "/api/settings" && init?.method === "PUT") return Promise.resolve(Response.json({ ok: true }));
    return Promise.resolve(Response.json({ ok: true, job: "install-job" }));
  }) as typeof fetch;
  const view = renderWithQueryClient(<MemoryRouter><AiGlance person={makePerson(role as "owner" | "admin" | "adult" | "teen" | "child" | "guest")} onPersonChange={() => undefined} /></MemoryRouter>);
  return { ...view, calls };
}

describe("AI and models feature levels", () => {
  test("shows six feature cards with four cells and no removed overview blocks", async () => {
    const { findAllByTestId, queryByText } = render();
    expect(await findAllByTestId("ai-feature-card")).toHaveLength(6);
    expect(await findAllByTestId("ai-level-grid")).toHaveLength(6);
    expect(queryByText("Needs attention")).toBeNull();
    expect(queryByText("Download all that is missing")).toBeNull();
  });
  test("selecting a model writes that level slot without installing", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(view.getAllByRole("combobox", { name: "Standard model" })[0]!);
    fireEvent.click(view.getAllByRole("option", { name: "Muse Glimmer" })[0]!);
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/settings" && call.init?.method === "PUT" && String(call.init.body).includes("engines.chat.tier.standard"))).toBe(true));
    expect(view.calls.some((call) => call.url.includes("/install"))).toBe(false);
  });
  test("Install uses the install-and-assign endpoint once", async () => {
    const missing = { ...base, features: [{ ...rows[0]!, levels: [mkLevel("reduced", "waits", null), mkLevel("standard", "missing", "Qwen"), mkLevel("boost"), mkLevel("max")] }] };
    const view = render(missing);
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Install 2.0 GB" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/ai/level/chat/standard/install")).toHaveLength(1));
  });
  test("level switch writes off and feature switch writes the real feature key", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click((await view.findAllByRole("switch", { name: "Boost level" }))[0]!);
    fireEvent.click(view.getByRole("switch", { name: "Chat" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/settings" && call.init?.method === "PUT").length).toBeGreaterThanOrEqual(2));
    const bodies = view.calls.filter((call) => call.init?.method === "PUT").map((call) => String(call.init?.body));
    expect(bodies.some((body) => body.includes("engines.chat.tier.boost") && body.includes("off"))).toBe(true);
    expect(bodies.some((body) => body.includes("chat.paused") && body.includes("true"))).toBe(true);
  });
  test("Details opens one sheet; Save writes only the level whose who changed", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click((await view.findAllByRole("button", { name: "Details" }))[1]!);
    expect(await view.findByText("Adult gate")).toBeTruthy();
    await view.findByText("Adult gate");
    // Each level has Everyone, Assigned, Admins in that order: the third radio is the first level's Admins.
    fireEvent.click((await view.findAllByRole("radio"))[2]!);
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/settings" && call.init?.method === "PUT" && String(call.init.body).includes("engines.image.tier.") && /"who":"(assigned|admins)"/.test(String(call.init.body)))).toBe(true));
    expect(view.calls.filter((call) => call.init?.method === "PUT" && String(call.init.body).includes("engines.image.tier.")).length).toBe(1);
  });
  test("a non-admin does not get the admin feature page", async () => {
    const view = render(base, "child");
    await waitFor(() => expect(view.queryByTestId("ai-features")).toBeNull());
  });
});
