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
const fm = (id: string, rank: number, state: string, over: Record<string, unknown> = {}) => ({ id, label: `Model ${id}`, description: `About ${id}.`, rank, state, size_bytes: state === "ready" ? 20e9 : 0, download_bytes: state === "missing" ? 36e9 : 0, percent: null, running: state === "ready", failure: null, install_block: null, ...over });
const modelsFor = (over: Record<string, unknown[]> = {}, audience = "adult", order: string[] = []) => ({ audience, features: [{ id: "pictures", ordered: true, order, models: over.pictures ?? [fm("a", 1, "ready"), fm("b", 2, "missing"), fm("c", 3, "ready")] }, { id: "videos", ordered: true, order: [], models: over.videos ?? [fm("v", 1, "ready")] }, { id: "music", ordered: true, order: [], models: over.music ?? [] }] });
const base = { features: rows, helpers: [helper("vision", "vision"), helper("coding", "coding"), helper("clearer", "pictures", "missing")], attention: { items: [], download_all: null }, right_now: { engine: "ready", waiting: 0, memory_free_bytes: 1e9, disk_free_bytes: 2e9, models_bytes: 3e9 } };
function render(data = base, role = "owner", models: unknown = modelsFor()) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString(); calls.push({ url, init }); const path = url.split("?")[0]!;
    if (path.endsWith("/api/ai/overview")) return Promise.resolve(Response.json(data));
    if (path.endsWith("/api/ai/feature-models")) return Promise.resolve(Response.json(models));
    if (path.includes("/api/ai/feature-models/") && init?.method === "PUT") return Promise.resolve(Response.json({ ok: true }));
    if (path === "/api/settings" && url.includes("scope=")) return Promise.resolve(Response.json(REGISTRY.filter((key) => key.scope === "household").map((key) => ({ key: key.key, value: key.key === "chat.paused" ? false : key.key.endsWith("tier.standard") ? { model: "model-qwen", who: "everyone", options: {} } : key.default ?? null, source: "default", label: key.label, help: key.help, level: key.level, secret: false }))));
    if (path === "/api/settings/registry") return Promise.resolve(Response.json(REGISTRY));
    if (path === "/api/settings" && init?.method === "PUT") return Promise.resolve(Response.json({ ok: true }));
    return Promise.resolve(Response.json({ ok: true, job: "install-job" }));
  }) as typeof fetch;
  const view = renderWithQueryClient(<MemoryRouter><AiGlance person={makePerson(role as "owner" | "admin" | "adult" | "teen" | "child" | "guest")} onPersonChange={() => undefined} /></MemoryRouter>);
  return { ...view, calls };
}

describe("AI and models feature rows", () => {
  test("seven rows: Pictures, Videos and Music list their models from the Stack, and none of the removed blocks show", async () => {
    const { findAllByTestId, queryByText, queryAllByTestId } = render();
    expect(await findAllByTestId("ai-feature-card")).toHaveLength(7);
    await waitFor(() => expect(queryAllByTestId("ai-model-line").length).toBeGreaterThan(0));
    expect(queryAllByTestId("ai-level-row")).toHaveLength(0);
    expect(queryByText("Needs attention")).toBeNull();
    expect(queryByText("Download all that is missing")).toBeNull();
    expect(document.body.textContent).not.toMatch(/automatic/i);
  });
  test("a feature row shows its first two models only, in the Stack's order, names as sent, Primary then Secondary", async () => {
    const view = render();
    const lists = await view.findAllByRole("list", { name: "Pictures models" });
    const lines = within(lists[0]!).getAllByTestId("ai-model-line");
    expect(lines.map((line) => within(line).getByTestId("ai-model-name").textContent)).toEqual(["Model a", "Model b"]);
    expect(within(lines[0]!).getByText("Primary")).toBeTruthy();
    expect(within(lines[1]!).getByText("Secondary")).toBeTruthy();
    expect(lists[0]!.textContent).not.toContain("Model c");
  });
  test("one control per state: ready has a dot and no button, missing has only Install with its size, failed has Try again; a model that is not ready is muted", async () => {
    const view = render(base, "owner", modelsFor({ pictures: [fm("a", 1, "ready"), fm("b", 2, "missing")], videos: [fm("v", 1, "failed", { install_block: null }), fm("w", 2, "installing", { percent: 40 })] }));
    const [ready, missing] = within((await view.findAllByRole("list", { name: "Pictures models" }))[0]!).getAllByTestId("ai-model-line");
    expect(within(ready!).queryByRole("button")).toBeNull();
    expect(ready!.textContent).not.toMatch(/Ready|Missing/);
    expect(within(missing!).getByRole("button", { name: "Install 36 GB" })).toBeTruthy();
    expect(missing!.textContent).not.toContain("Missing");
    expect(within(missing!).getByTestId("ai-model-name").parentElement!.className).toContain("text-muted-foreground");
    expect(within(ready!).getByTestId("ai-model-name").parentElement!.className).not.toContain("text-muted-foreground");
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(view.getByText("Installing 40%")).toBeTruthy();
    fireEvent.click(within(missing!).getByRole("button", { name: "Install 36 GB" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/components/b/install")).toHaveLength(1));
  });
  test("Change is plain text and opens a sheet of the Stack's models with their descriptions; Move to top writes the household order", async () => {
    const view = render();
    await view.findAllByTestId("ai-model-line");
    const change = view.getByRole("button", { name: "Change Pictures" });
    expect(change.getAttribute("data-variant")).toBe("quiet-link");
    fireEvent.click(change);
    const sheet = await view.findByTestId("ai-model-chooser");
    const options = within(sheet).getAllByTestId("ai-chooser-option");
    expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining("Model a"), expect.stringContaining("Model b"), expect.stringContaining("Model c")]);
    expect(within(sheet).getByText(/About a\./)).toBeTruthy();
    expect(within(options[2]!).getByRole("button", { name: "Move Model c to the top" })).toBeTruthy();
    expect(within(options[0]!).queryByText("Move to top")).toBeNull();
    fireEvent.click(within(options[2]!).getByRole("button", { name: "Move Model c to the top" }));
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/ai/feature-models/pictures/order" && call.init?.method === "PUT" && String(call.init.body) === JSON.stringify({ order: ["c"] }))).toBe(true));
  });
  test("the sheet's buttons stay off until the fresh list is back, so a second click cannot act on a stale sheet (CHOOSER-REFRESH-01)", async () => {
    const view = render();
    const inner = globalThis.fetch;
    let held = false; let release: (() => void) | null = null;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (init?.method === "PUT" && url.includes("/api/ai/feature-models/")) held = true;
      if (held && url.endsWith("/api/ai/feature-models") && !release) return new Promise<Response>((resolve) => { release = () => resolve(inner(input, init)); });
      return inner(input, init);
    }) as typeof fetch;
    await view.findAllByTestId("ai-model-line");
    fireEvent.click(view.getByRole("button", { name: "Change Pictures" }));
    const sheet = await view.findByTestId("ai-model-chooser");
    fireEvent.click(within(within(sheet).getAllByTestId("ai-chooser-option")[2]!).getByRole("button", { name: "Move Model c to the top" }));
    await waitFor(() => expect(release).not.toBeNull());
    const during = within(sheet).queryAllByRole("button", { name: /to the top$/ }) as HTMLButtonElement[];
    expect(during.length).toBeGreaterThan(0);
    for (const button of during) expect(button.disabled).toBe(true);
    release!();
    await waitFor(() => { for (const button of within(sheet).queryAllByRole("button", { name: /to the top$/ }) as HTMLButtonElement[]) expect(button.disabled).toBe(false); });
  });
  test("a household order offers Use the default order, which writes an empty order", async () => {
    const view = render(base, "owner", modelsFor({}, "adult", ["c"]));
    await view.findAllByTestId("ai-model-line");
    fireEvent.click(view.getByRole("button", { name: "Change Pictures" }));
    fireEvent.click(await view.findByRole("button", { name: "Use the default order" }));
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/ai/feature-models/pictures/order" && String(call.init?.body) === JSON.stringify({ order: [] }))).toBe(true));
  });
  test("a minor's list has no Change and the page prints only what the Stack sent", async () => {
    const view = render(base, "owner", modelsFor({ pictures: [fm("a", 1, "ready", { label: "Picture maker", description: "" })] }, "minor"));
    await view.findAllByTestId("ai-model-line");
    expect(view.queryByRole("button", { name: "Change Pictures" })).toBeNull();
    expect(view.getAllByText("Picture maker").length).toBeGreaterThan(0);
  });
  test("a feature the Stack lists no model for says so", async () => {
    const view = render();
    expect(await view.findByText("No models listed yet.")).toBeTruthy();
  });
  test("one row opens at a time and shows its real levels with the model that runs", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Chat" }));
    expect(view.getAllByTestId("ai-level-row")).toHaveLength(4);
    expect(view.getAllByTestId("ai-level-model").map((node) => node.textContent)).toContain("Qwen");
    expect(view.getByText("Max has no model for Chat yet. Choose one, for example Qwen.")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Pictures" }));
    expect(view.queryAllByTestId("ai-level-row")).toHaveLength(0);
  });
  test("Vision and Coding rows come from their helpers; a helper sits inside its parent row and installs the real part", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    expect((await view.findAllByTestId("ai-feature-summary")).map((node) => node.textContent)).toContain("vision model");
    fireEvent.click(view.getByRole("button", { name: "Pictures" }));
    fireEvent.click(await view.findByRole("button", { name: "Install 3.0 GB" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/components/clearer-part/install")).toHaveLength(1));
  });
  test("Chat's Change opens the level picker: Recommended first, then models with size and what each is good at; an installed model writes through the level endpoint", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Change Chat" }));
    const picker = await view.findByTestId("ai-model-picker");
    expect(within(picker).getAllByRole("button").map((node) => node.textContent)).toEqual(expect.arrayContaining(["Use", "Install 36 GB"]));
    expect(within(picker).getByText(/Longer answers/)).toBeTruthy();
    expect(picker.textContent).not.toMatch(/automatic/i);
    fireEvent.click(within(picker).getAllByRole("button", { name: "Use" })[1]!);
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/ai/level/chat/standard/install" && String(call.init?.body).includes("model-muse"))).toHaveLength(1));
  });
  test("Use recommended writes the level slot back to recommended when a model was picked by hand", async () => {
    const pinned = { ...base, features: [{ ...rows[0]!, levels: [mkLevel("standard", "ready", { automatic: false, model_label: "Muse Glimmer", model_id: "model-muse" }), mkLevel("boost")] }] };
    const view = render(pinned);
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Change Chat" }));
    const picker = await view.findByTestId("ai-model-picker");
    fireEvent.click(within(picker).getAllByRole("button", { name: "Use recommended" })[0]!);
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/settings" && call.init?.method === "PUT" && String(call.init.body).includes("engines.chat.tier.standard") && String(call.init.body).includes("recommended"))).toBe(true));
  });
  test("a missing chat model shows only Install with its size on the row and installs the real part", async () => {
    const missing = { ...base, features: [{ ...rows[0]!, levels: [mkLevel("standard", "missing", { model_label: "Big One", model_id: "model-big", size_bytes_missing: 2e9, action: { kind: "download", label: "Install" } }), mkLevel("boost"), mkLevel("max", "off", { model_label: null })] }] };
    const view = render(missing);
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Install 2.0 GB" }));
    await waitFor(() => expect(view.calls.filter((call) => call.url === "/api/components/model-big/install")).toHaveLength(1));
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
  test("Who can use each level opens one sheet of compact radio rows; Save writes only the level whose who changed", async () => {
    const view = render();
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Pictures" }));
    fireEvent.click(await view.findByRole("button", { name: "Who can use each level" }));
    expect(await view.findByText("Adult gate")).toBeTruthy();
    const radios = await view.findAllByRole("radio");
    expect(radios[0]!.closest("[data-slot=field-label]")).toBeNull();
    // Each level has Everyone, Assigned, Admins in that order: the third radio is the first level's Admins.
    fireEvent.click(radios[2]!);
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/settings" && call.init?.method === "PUT" && String(call.init.body).includes("engines.image.tier.") && /"who":"(assigned|admin)/.test(String(call.init.body)))).toBe(true));
    expect(view.calls.filter((call) => call.init?.method === "PUT" && String(call.init.body).includes("engines.image.tier.")).length).toBe(1);
  });
  test("an Off level in the sheet is one plain line with one action, and a level with no model yet says so with Choose a model", async () => {
    const offFeature = { ...rows[1]!, levels: [mkLevel("standard"), mkLevel("boost", "off", { model_label: null }), mkLevel("max", "unset", { model_label: null, model_id: null, automatic: false })] };
    const view = render({ ...base, features: [rows[0]!, offFeature, ...rows.slice(2)] });
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Pictures" }));
    fireEvent.click(await view.findByRole("button", { name: "Who can use each level" }));
    const boost = await view.findByTestId("ai-access-boost");
    expect(within(boost).getByText("Off")).toBeTruthy();
    expect(within(boost).getAllByRole("button")).toHaveLength(1);
    expect(within(boost).queryAllByRole("radio")).toHaveLength(0);
    const max = view.getByTestId("ai-access-max");
    expect(within(max).getByText("No model yet")).toBeTruthy();
    expect(within(max).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(boost).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(view.calls.some((call) => call.url === "/api/settings" && call.init?.method === "PUT" && String(call.init.body).includes("engines.image.tier.boost") && String(call.init.body).includes("recommended"))).toBe(true));
  });
  test("a level the Stack does not offer says why and has no picker", async () => {
    const none = { ...base, features: [{ ...rows[0]!, levels: [mkLevel("standard"), mkLevel("boost", "unset", { model_label: null, model_id: null, automatic: false, can_choose: false, options: [], detail: "Chat has no Boost model on this Mac; it uses Standard." })] }] };
    const view = render(none);
    await view.findByTestId("ai-features");
    fireEvent.click(await view.findByRole("button", { name: "Chat" }));
    expect(view.getByText("Chat has no Boost model on this Mac; it uses Standard.")).toBeTruthy();
    expect(view.getAllByRole("button", { name: "Change" })).toHaveLength(1);
  });
  test("a non-admin does not get the admin feature page", async () => {
    const view = render(base, "child");
    await waitFor(() => expect(view.queryByTestId("ai-features")).toBeNull());
  });
});
