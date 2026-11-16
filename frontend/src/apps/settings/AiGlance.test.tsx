import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MemoryRouter } from "react-router-dom";
import { AiGlance } from "@/apps/settings/AiGlance";
import { makePerson, REGISTRY } from "@/shell/pages/settings/settingsTestKit";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });
const options = [{ id: "model-qwen", label: "Qwen", installed: true, size_bytes: 21e9, good_at: "Everyday chat", suggested: true }, { id: "model-muse", label: "Muse Glimmer", installed: true, size_bytes: 20e9, good_at: "Longer answers", suggested: false }, { id: "model-big", label: "Big One", installed: false, size_bytes: 36e9, good_at: "Hard questions", suggested: false }];
const mkLevel = (tier: string, state: string = "ready", over: Record<string, unknown> = {}) => ({ tier, state, word: state, model_label: "Qwen", automatic: true, model_id: "model-qwen", can_choose: true, options, size_bytes_missing: state === "missing" ? 2e9 : null, detail: null, action: state === "missing" ? { kind: "download", label: "Install", job: "chat", level: tier } : null, ...over });
const levelsFor = (id: string) => id === "voice" ? [mkLevel("reduced"), mkLevel("standard"), mkLevel("boost", "same", { model_label: null, can_choose: false }), mkLevel("max", "same", { model_label: null, can_choose: false })] : id === "chat" ? [mkLevel("reduced", "off", { model_label: null }), mkLevel("standard"), mkLevel("boost"), mkLevel("max", "unset", { model_label: null, model_id: null, automatic: false, detail: "Max has no model for Chat yet. Choose one, for example Qwen." })] : [mkLevel("standard"), mkLevel("boost"), mkLevel("max")];
const rows = ["chat", "pictures", "videos", "music", "voice"].map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), used_by: ["chat"], levels: levelsFor(id), ready_count: 1, level_count: 4 }));
const helper = (id: string, parent: string, state = "ready", over: Record<string, unknown> = {}) => ({ id, name: `${id} helper`, parent, component_id: `${id}-part`, size_bytes_missing: state === "missing" ? 3e9 : null, model_label: `${id} model`, used_by: [], state, action: state === "missing" ? { kind: "download", label: "Install", job: id } : null, ...over });
const base = { features: rows, helpers: [helper("vision", "vision"), helper("coding", "coding"), helper("clearer", "pictures", "missing")], attention: { items: [], download_all: null }, right_now: { engine: "ready", waiting: 0, memory_free_bytes: 1e9, disk_free_bytes: 2e9, models_bytes: 3e9 } };
function render(data = base, role = "owner") {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString(); calls.push({ url, init }); const path = url.split("?")[0]!;
    if (path.endsWith("/api/ai/overview")) return Promise.resolve(Response.json(data));
    if (path === "/api/settings" && url.includes("scope=")) return Promise.resolve(Response.json(REGISTRY.filter((key) => key.scope === "household").map((key) => ({ key: key.key, value: key.key === "chat.paused" ? false : key.key.endsWith("tier.standard") ? { model: "model-qwen", who: "everyone", options: {} } : key.default ?? null, source: "default", label: key.label, help: key.help, level: key.level, secret: false }))));
    if (path === "/api/settings/registry") return Promise.resolve(Response.json(REGISTRY));
    if (path === "/api/settings" && init?.method === "PUT") return Promise.resolve(Response.json({ ok: true }));
    return Promise.resolve(Response.json({ ok: true, job: "install-job" }));
  }) as typeof fetch;
  const view = renderWithQueryClient(<MemoryRouter><AiGlance person={makePerson(role as "owner" | "admin" | "adult" | "teen" | "child" | "guest")} onPersonChange={() => undefined} /></MemoryRouter>);
  return { ...view, calls };
}

describe("AI and models feature rows", () => {
  test("seven collapsed rows, each with a one-line summary, and none of the removed blocks", async () => {
    const { findAllByTestId, queryByText, queryAllByTestId } = render();
    expect(await findAllByTestId("ai-feature-card")).toHaveLength(7);
    expect((await findAllByTestId("ai-feature-summary"))[0]!.textContent).toBe("Standard: Qwen, ready");
    expect(queryAllByTestId("ai-level-row")).toHaveLength(0);
    expect(queryByText("Needs attention")).toBeNull();
    expect(queryByText("Download all that is missing")).toBeNull();
  });
  test("one row opens at a time and shows its real levels with the model that runs", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Chat" }));
    expect(view.getAllByTestId("ai-level-row")).toHaveLength(4);
    expect(view.getAllByTestId("ai-level-model").map((node) => node.textContent)).toContain("Automatic: Qwen");
    expect(view.getByText("Max has no model for Chat yet. Choose one, for example Qwen.")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Pictures" }));
    expect(view.getAllByTestId("ai-level-row")).toHaveLength(3);
  });
  test("Vision and Coding rows come from their helpers; a helper sits inside its parent row and installs the real part", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    expect((await view.findAllByTestId("ai-feature-summary")).map((node) => node.textContent)).toContain("vision helper: ready");
    fireEvent.click(view.getByRole("button", { name: "Pictures" }));
    fireEvent.click(await view.findByRole("button", { name: "Install 3.0 GB" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/components/clearer-part/install")).toHaveLength(1));
  });
  test("Change opens one picker: Use automatic first, then models with size and what each is good at; an installed model writes through the level endpoint", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Chat" }));
    fireEvent.click(view.getAllByRole("button", { name: "Change" })[1]!);
    const picker = await view.findByTestId("ai-model-picker");
    expect(within(picker).getAllByRole("button").map((node) => node.textContent)).toEqual(expect.arrayContaining(["Use", "Install 36 GB"]));
    expect(within(picker).getByText(/Longer answers/)).toBeTruthy();
    fireEvent.click(within(picker).getAllByRole("button", { name: "Use" })[1]!);
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/ai/level/chat/standard/install" && String(call.init?.body).includes("model-muse"))).toHaveLength(1));
  });
  test("Use automatic writes the level slot back to recommended when a model was picked by hand", async () => {
    const pinned = { ...base, features: [{ ...rows[0]!, levels: [mkLevel("standard", "ready", { automatic: false, model_label: "Muse Glimmer", model_id: "model-muse" }), mkLevel("boost")] }] };
    const view = render(pinned);
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Chat" }));
    expect(view.getAllByTestId("ai-level-model")[0]!.textContent).toBe("Muse Glimmer");
    fireEvent.click(view.getAllByRole("button", { name: "Change" })[0]!);
    const picker = await view.findByTestId("ai-model-picker");
    fireEvent.click(within(picker).getAllByRole("button", { name: "Use automatic" })[0]!);
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/settings" && call.init?.method === "PUT" && String(call.init.body).includes("engines.chat.tier.standard") && String(call.init.body).includes("recommended"))).toBe(true));
  });
  test("a missing model installs with its size, inline, without a licence step", async () => {
    const missing = { ...base, features: [{ ...rows[0]!, levels: [mkLevel("standard", "missing", { model_label: "Big One", model_id: "model-big" }), mkLevel("boost"), mkLevel("max", "off", { model_label: null })] }] };
    const view = render(missing);
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Chat" }));
    fireEvent.click(await view.findByRole("button", { name: "Install 2.0 GB" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/components/model-big/install")).toHaveLength(1));
  });
  test("a level the Stack does not offer says why and has no picker", async () => {
    const none = { ...base, features: [{ ...rows[2]!, levels: [mkLevel("standard"), mkLevel("boost", "unset", { model_label: null, model_id: null, automatic: false, can_choose: false, options: [], detail: "Videos has no Boost model on this Mac; it uses Standard." })] }] };
    const view = render(none);
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Videos" }));
    expect(view.getByText("Videos has no Boost model on this Mac; it uses Standard.")).toBeTruthy();
    expect(view.getAllByRole("button", { name: "Change" })).toHaveLength(1);
  });
  test("level switch writes off and feature switch writes the real feature key", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Chat" }));
    fireEvent.click(view.getAllByRole("switch", { name: "Chat Boost on or off" })[0]!);
    fireEvent.click(view.getByRole("switch", { name: "Chat on or off" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/settings" && call.init?.method === "PUT").length).toBeGreaterThanOrEqual(2));
    const bodies = view.calls.filter((call) => call.init?.method === "PUT").map((call) => String(call.init?.body));
    expect(bodies.some((body) => body.includes("engines.chat.tier.boost") && body.includes("off"))).toBe(true);
    expect(bodies.some((body) => body.includes("chat.paused") && body.includes("true"))).toBe(true);
  });
  test("Who can use each level opens one sheet; Save writes only the level whose who changed", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Pictures" }));
    fireEvent.click(await view.findByRole("button", { name: "Who can use each level" }));
    expect(await view.findByText("Adult gate")).toBeTruthy();
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
